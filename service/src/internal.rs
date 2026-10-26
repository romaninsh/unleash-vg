//! What the service compiled, for the admin app and the web API (not for SDKs):
//! `GET /internal/features[?env_key=..][&flag_name=..]` with `Authorization: Bearer <INTERNAL_TOKEN>`.
//! Off unless INTERNAL_TOKEN is set.

use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::api::App;
use crate::state::Served;

pub async fn features(State(app): State<App>, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let Some(token) = app.internal_token.as_deref() else {
        return (StatusCode::NOT_FOUND, Json(json!({ "message": "Not found" }))).into_response();
    };
    if !authorized(&headers, token) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "message": "Unauthorized" }))).into_response();
    }
    Json(rows(&app.served, q.get("env_key").map(String::as_str), q.get("flag_name").map(String::as_str))).into_response()
}

/// One row per served feature, by environment then flag; `feature` is the JSON as SDKs get it.
pub fn rows(served: &Served, env_key: Option<&str>, flag_name: Option<&str>) -> Vec<Value> {
    let envs = served.envs.read().expect("lock");
    let mut keys: Vec<&String> = envs.keys().filter(|e| env_key.is_none_or(|k| k == e.as_str())).collect();
    keys.sort();
    let mut out = Vec::new();
    for env in keys {
        let mut features: Vec<_> = envs[env].features.iter().filter(|f| flag_name.is_none_or(|n| n == f.name)).collect();
        features.sort_by(|a, b| a.name.cmp(&b.name));
        for f in features {
            out.push(json!({
                "id": format!("{}@{env}", f.name), "flag_name": f.name, "env_key": env,
                "enabled": f.switch, "served_enabled": f.json["enabled"].as_bool().unwrap_or(false),
                "feature": f.json.to_string(),
            }));
        }
    }
    out
}

/// `Authorization: Bearer <token>`, compared by digest so the time taken says nothing.
pub fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let sent = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer "));
    sent.is_some_and(|s| Sha256::digest(s.as_bytes()) == Sha256::digest(token.as_bytes()))
}

#[cfg(test)]
mod tests;
