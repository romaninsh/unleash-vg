//! The Unleash-compatible SDK API (spec 04). Paths are relative to the service's base URL;
//! SDKs are configured with `<base>/api`.

use std::collections::{BTreeSet, HashMap};
use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tower_http::cors::{AllowHeaders, AllowOrigin, CorsLayer};
use unleash_types::client_features::Context;

use crate::metrics::{BulkPost, Metrics, MetricsPost, RegisterPost};
use crate::state::Served;
use crate::store::Store;
use crate::tokens::{Kind, Token, Tokens, secret_from_header};

#[derive(Clone)]
pub struct App {
    pub store: Arc<Store>,
    pub served: Arc<Served>,
    pub tokens: Arc<Tokens>,
    pub metrics: Arc<Metrics>,
    /// Serve the two Unleash Edge endpoints (EDGE_ENDPOINTS=true); off unless Edge is used.
    pub edge: bool,
}

/// Edge requests larger than these are refused (400), so one post can't flood the buffer.
const EDGE_MAX_TOKENS: usize = 1_000;
const EDGE_MAX_METRICS: usize = 5_000;
const EDGE_MAX_APPLICATIONS: usize = 1_000;

type Params = Query<Vec<(String, String)>>;

pub fn router(app: App) -> Router {
    let served = app.served.clone();
    // CORS for the Frontend API only (spec 04 "CORS"): settings.frontend_cors_origins; empty or
    // "*" = any origin. With credentials allowed the origin is mirrored rather than "*".
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(move |origin: &HeaderValue, _| {
            let allowed = served.settings.read().expect("lock").cors_origins.clone();
            allowed.is_empty()
                || allowed.iter().any(|a| a == "*")
                || origin.to_str().is_ok_and(|o| allowed.iter().any(|a| a.trim_end_matches('/') == o))
        }))
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(AllowHeaders::mirror_request())
        .expose_headers([header::ETAG]);

    let frontend = Router::new()
        .route("/api/frontend", get(frontend_get).post(frontend_post))
        .route("/api/frontend/", get(frontend_get).post(frontend_post))
        .route("/api/frontend/client/metrics", post(frontend_metrics))
        .route("/api/frontend/client/register", post(frontend_register))
        .layer(cors);

    let mut routes = Router::new()
        .route("/health", get(|| async { Json(json!({ "health": "GOOD" })) }))
        .route("/api/client/features", get(client_features))
        .route("/api/client/features/{name}", get(client_feature))
        .route("/api/client/register", post(client_register))
        .route("/api/client/metrics", post(client_metrics));
    if app.edge {
        routes = routes
            .route("/api/client/metrics/bulk", post(client_metrics_bulk))
            .route("/edge/validate", post(edge_validate));
    }
    routes
        .merge(frontend)
        .fallback(|| async { error(StatusCode::NOT_FOUND, "Not found") })
        .with_state(app)
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "message": message }))).into_response()
}

/// The request's token, of the kind the endpoint needs: unknown or missing -> 401, a valid
/// token of the other kind -> 403 (spec 04 "Errors").
async fn authorize(app: &App, headers: &HeaderMap, kind: Kind) -> Result<Token, Response> {
    let secret = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).map(secret_from_header).unwrap_or("");
    let token = match app.tokens.resolve(&app.store, secret).await {
        Ok(Some(t)) => t,
        Ok(None) => return Err(error(StatusCode::UNAUTHORIZED, "Unauthorized: unknown or missing token")),
        Err(e) => {
            tracing::error!(error = %e, "token lookup failed");
            return Err(error(StatusCode::SERVICE_UNAVAILABLE, "Token store unavailable"));
        }
    };
    if token.kind != kind {
        return Err(error(StatusCode::FORBIDDEN, "Forbidden: this token can't be used for this API"));
    }
    app.tokens.mark_used(&app.store, &token);
    Ok(token)
}

fn parse_json<T: serde::de::DeserializeOwned>(body: &Bytes) -> Result<T, Response> {
    serde_json::from_slice(body).map_err(|e| error(StatusCode::BAD_REQUEST, &format!("Invalid body: {e}")))
}

// ------------------------------------------------------------------ Client API (backend SDKs)

struct FeatureQuery {
    name_prefix: Option<String>,
    tags: BTreeSet<String>,
    other_project: bool,
    hash: String,
    echo: Value,
}

fn feature_query(params: &[(String, String)], env: &str) -> FeatureQuery {
    let mut name_prefix = None;
    let mut tags = BTreeSet::new();
    let mut projects = BTreeSet::new();
    for (k, v) in params {
        match k.as_str() {
            "namePrefix" => name_prefix = Some(v.clone()),
            // "type:value"; we have no tag types, so only the value counts
            "tag" | "tag[]" => {
                tags.insert(v.split_once(':').map(|(_, val)| val).unwrap_or(v).to_lowercase());
            }
            "project" | "project[]" => {
                projects.insert(v.clone());
            }
            _ => {}
        }
    }
    let other_project = projects.iter().any(|p| p != "default");
    let normalised = format!("namePrefix={};tag={:?};project={:?}", name_prefix.clone().unwrap_or_default(), tags, projects);
    let hash = hex::encode(&Sha256::digest(normalised.as_bytes())[..8]);
    let mut echo = json!({ "environment": env, "project": if projects.is_empty() { vec!["default".to_string()] } else { projects.into_iter().collect() } });
    if let Some(p) = &name_prefix {
        echo["namePrefix"] = json!(p);
    }
    if !tags.is_empty() {
        echo["tag"] = json!(tags.iter().collect::<Vec<_>>());
    }
    FeatureQuery { name_prefix, tags, other_project, hash, echo }
}

async fn client_features(State(app): State<App>, headers: HeaderMap, Query(params): Params) -> Response {
    let token = match authorize(&app, &headers, Kind::Backend).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    let Some(snapshot) = app.served.env(&token.environment) else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "Flags are still loading");
    };
    let q = feature_query(&params, &token.environment);
    let etag = format!("\"{}:{}:v1\"", q.hash, snapshot.revision);
    if headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(etag.as_str()) {
        return (StatusCode::NOT_MODIFIED, [(header::ETAG, etag)]).into_response();
    }
    let features: Vec<&Value> = if q.other_project {
        vec![]
    } else {
        snapshot
            .features
            .iter()
            .filter(|f| q.name_prefix.as_ref().is_none_or(|p| f.name.starts_with(p.as_str())))
            .filter(|f| q.tags.is_empty() || f.tags.iter().any(|t| q.tags.contains(t)))
            .map(|f| &f.json)
            .collect()
    };
    let body = json!({
        "version": 2,
        "features": features,
        "query": q.echo,
        "meta": { "revisionId": snapshot.revision, "etag": etag, "queryHash": q.hash },
    });
    ([(header::ETAG, etag)], Json(body)).into_response()
}

async fn client_feature(State(app): State<App>, headers: HeaderMap, Path(name): Path<String>) -> Response {
    let token = match authorize(&app, &headers, Kind::Backend).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    let Some(snapshot) = app.served.env(&token.environment) else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "Flags are still loading");
    };
    match snapshot.features.iter().find(|f| f.name == name) {
        Some(f) => Json(f.json.clone()).into_response(),
        None => error(StatusCode::NOT_FOUND, &format!("No feature named {name}")),
    }
}

async fn client_register(State(app): State<App>, headers: HeaderMap, body: Bytes) -> Response {
    let token = match authorize(&app, &headers, Kind::Backend).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    let reg: RegisterPost = match parse_json(&body) {
        Ok(r) => r,
        Err(r) => return r,
    };
    app.metrics.app(&reg.app_name, &token.environment, reg.instance_id.as_deref(), reg.sdk_version.as_deref());
    StatusCode::ACCEPTED.into_response()
}

fn record_metrics(app: &App, env: &str, m: MetricsPost) {
    app.metrics.app(&m.app_name, env, m.instance_id.as_deref(), m.sdk_version.as_deref());
    let counts = m.bucket.toggles.into_iter().map(|(name, c)| (name, c.yes, c.no));
    app.metrics.count(&app.served, env, &m.app_name, counts);
}

async fn client_metrics(State(app): State<App>, headers: HeaderMap, body: Bytes) -> Response {
    let token = match authorize(&app, &headers, Kind::Backend).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    match parse_json::<MetricsPost>(&body) {
        Ok(m) => {
            record_metrics(&app, &token.environment, m);
            StatusCode::ACCEPTED.into_response()
        }
        Err(r) => r,
    }
}

/// Only if Unleash Edge is deployed: keep the rows for the token's own environment.
async fn client_metrics_bulk(State(app): State<App>, headers: HeaderMap, body: Bytes) -> Response {
    let token = match authorize(&app, &headers, Kind::Backend).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    let bulk: BulkPost = match parse_json(&body) {
        Ok(b) => b,
        Err(r) => return r,
    };
    if bulk.metrics.len() > EDGE_MAX_METRICS || bulk.applications.len() > EDGE_MAX_APPLICATIONS {
        return error(StatusCode::BAD_REQUEST, &format!("At most {EDGE_MAX_METRICS} metrics and {EDGE_MAX_APPLICATIONS} applications per post"));
    }
    for a in &bulk.applications {
        if let Some(name) = a["appName"].as_str() {
            app.metrics.app(name, &token.environment, a["instanceId"].as_str(), a["sdkVersion"].as_str());
        }
    }
    let mut per_app: HashMap<String, Vec<(String, i64, i64)>> = HashMap::new();
    for m in bulk.metrics.into_iter().filter(|m| m.environment == token.environment) {
        per_app.entry(m.app_name).or_default().push((m.feature_name, m.yes, m.no));
    }
    for (name, counts) in per_app {
        app.metrics.count(&app.served, &token.environment, &name, counts);
    }
    StatusCode::ACCEPTED.into_response()
}

/// Only if Unleash Edge is deployed: which of these secrets are valid tokens.
async fn edge_validate(State(app): State<App>, body: Bytes) -> Response {
    let req: Value = match parse_json(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let asked = req["tokens"].as_array().map_or(0, Vec::len);
    if asked > EDGE_MAX_TOKENS {
        return error(StatusCode::BAD_REQUEST, &format!("At most {EDGE_MAX_TOKENS} tokens per request"));
    }
    let mut valid = vec![];
    for secret in req["tokens"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        if let Ok(Some(t)) = app.tokens.resolve(&app.store, secret).await {
            let kind = if t.kind == Kind::Frontend { "frontend" } else { "backend" };
            valid.push(json!({ "token": secret, "type": kind, "projects": ["*"], "environment": t.environment }));
        }
    }
    Json(json!({ "tokens": valid })).into_response()
}

// ------------------------------------------------------------------ Frontend API (web, mobile)

/// Build the evaluation context as upstream's create-context does (spec 03): appName,
/// environment, userId, sessionId, remoteAddress (and currentTime) are top-level; everything
/// else goes into properties. The environment always comes from the token.
fn build_context(fields: Vec<(String, Value)>, env: &str, peer: &SocketAddr) -> Context {
    let mut ctx = Context { environment: Some(env.to_string()), ..Default::default() };
    let mut props: HashMap<String, String> = HashMap::new();
    let text = |v: &Value| match v {
        Value::String(s) => Some(s.clone()),
        Value::Null => None,
        other => Some(other.to_string()),
    };
    for (key, value) in fields {
        match key.as_str() {
            "userId" => ctx.user_id = text(&value),
            "sessionId" => ctx.session_id = text(&value),
            "appName" => ctx.app_name = text(&value),
            "remoteAddress" => ctx.remote_address = text(&value),
            "currentTime" => ctx.current_time = text(&value),
            "environment" => {}
            "properties" => {
                for (k, v) in value.as_object().into_iter().flatten() {
                    if let Some(s) = text(v) {
                        props.insert(k.clone(), s);
                    }
                }
            }
            _ => {
                // GET form: properties[brand]=bank-c
                let name = key.strip_prefix("properties[").and_then(|k| k.strip_suffix(']')).unwrap_or(&key);
                if let Some(s) = text(&value) {
                    props.insert(name.to_string(), s);
                }
            }
        }
    }
    if ctx.remote_address.is_none() {
        ctx.remote_address = Some(peer.ip().to_string());
    }
    if ctx.session_id.is_none() {
        ctx.session_id = Some(uuid::Uuid::new_v4().to_string());
    }
    if !props.is_empty() {
        ctx.properties = Some(props);
    }
    ctx
}

async fn frontend(app: &App, headers: &HeaderMap, fields: Vec<(String, Value)>, peer: &SocketAddr) -> Response {
    let token = match authorize(app, headers, Kind::Frontend).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    let Some(snapshot) = app.served.env(&token.environment) else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "Flags are still loading");
    };
    let ctx = build_context(fields, &token.environment, peer);
    // Only enabled flags are listed (spec 04), in name order.
    let toggles: Vec<Value> = snapshot
        .features
        .iter()
        .filter(|f| snapshot.engine.is_enabled(&f.name, &ctx, &None))
        .map(|f| {
            json!({
                "name": f.name,
                "enabled": true,
                "impressionData": false,
                "variant": { "name": "disabled", "enabled": false, "feature_enabled": true, "featureEnabled": true },
            })
        })
        .collect();
    ([(header::CACHE_CONTROL, "no-cache")], Json(json!({ "toggles": toggles }))).into_response()
}

async fn frontend_get(State(app): State<App>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Query(params): Params) -> Response {
    let fields = params.into_iter().map(|(k, v)| (k, Value::String(v))).collect();
    frontend(&app, &headers, fields, &peer).await
}

async fn frontend_post(State(app): State<App>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, body: Bytes) -> Response {
    let req: Value = if body.is_empty() { json!({}) } else {
        match parse_json(&body) {
            Ok(v) => v,
            Err(r) => return r,
        }
    };
    let fields = req["context"].as_object().cloned().unwrap_or_default().into_iter().collect();
    frontend(&app, &headers, fields, &peer).await
}

async fn frontend_metrics(State(app): State<App>, headers: HeaderMap, body: Bytes) -> Response {
    let token = match authorize(&app, &headers, Kind::Frontend).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    match parse_json::<MetricsPost>(&body) {
        Ok(m) => {
            record_metrics(&app, &token.environment, m);
            StatusCode::OK.into_response()
        }
        Err(r) => r,
    }
}

async fn frontend_register(State(app): State<App>, headers: HeaderMap, body: Bytes) -> Response {
    let token = match authorize(&app, &headers, Kind::Frontend).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    match parse_json::<RegisterPost>(&body) {
        Ok(reg) => {
            app.metrics.app(&reg.app_name, &token.environment, reg.instance_id.as_deref(), reg.sdk_version.as_deref());
            StatusCode::OK.into_response()
        }
        Err(r) => r,
    }
}
