//! flag-service: the Unleash-compatible SDK API of the Flag Service (spec 04), serving the
//! flags the admin app keeps in SurrealDB. Data access goes through the Vantage framework;
//! evaluation for the Frontend API uses Unleash's official engine, Yggdrasil.
//!
//!   flag-service                      serve (configuration from the environment, below)
//!   flag-service create-token <name> <backend|frontend> <environment>
//!                                     create a token and print its secret once
//!   flag-service import-token <name> <backend|frontend|client> <environment> <secret>
//!                                     store an existing Unleash secret verbatim (spec 09 step 3)
//!
//! Environment: SURREAL_URL (ws://127.0.0.1:8000), SURREAL_NS / SURREAL_DB (flags),
//! SURREAL_USER / SURREAL_PASS (root), SURREAL_AUTH (the level they sign in at: root, namespace or
//! database; root), PORT (4380), METRICS_FLUSH_SECS (30), TOKEN_CACHE_SECS (how long a checked
//! API token is trusted before it is checked again; 30), RUST_LOG (info),
//! EDGE_ENDPOINTS (`true` serves /edge/validate and /api/client/metrics/bulk for Unleash Edge),
//! INTERNAL_TOKEN (bearer token of /internal/features, what the admin app reads; unset = off).

mod api;
mod compile;
mod internal;
mod metrics;
mod state;
mod store;
mod tokens;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::http::{HeaderName, HeaderValue};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::set_header::SetResponseHeaderLayer;

use crate::store::{AuthLevel, DbConfig, Store};

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with_writer(std::io::stderr) // stdout carries the printed secret of create-token
        .init();

    let store = Arc::new(Store::new(DbConfig {
        url: env_or("SURREAL_URL", "ws://127.0.0.1:8000"),
        namespace: env_or("SURREAL_NS", "flags"),
        database: env_or("SURREAL_DB", "flags"),
        user: env_or("SURREAL_USER", "root"),
        pass: env_or("SURREAL_PASS", "root"),
        auth: AuthLevel::from_env_value(&env_or("SURREAL_AUTH", "root"))?,
    }));

    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        [] => serve(store).await,
        ["create-token", name, kind @ ("backend" | "frontend"), env] => {
            let secret = format!("default:{env}.{}", hex::encode(rand_bytes::<28>()));
            tokens::save_token(&store, name, kind, env, &secret, "created").await?;
            println!("{secret}");
            Ok(())
        }
        ["import-token", name, kind @ ("backend" | "frontend" | "client"), env, secret] => {
            let kind = if *kind == "client" { "backend" } else { kind };
            tokens::save_token(&store, name, kind, env, secret, "imported").await?;
            println!("imported {kind} token \"{name}\" for {env}");
            Ok(())
        }
        _ => anyhow::bail!(
            "usage: flag-service [create-token <name> <backend|frontend> <env> | import-token <name> <backend|frontend|client> <env> <secret>]"
        ),
    }
}

fn rand_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    for chunk in b.chunks_mut(16) {
        let u = uuid::Uuid::new_v4();
        chunk.copy_from_slice(&u.as_bytes()[..chunk.len()]);
    }
    b
}

async fn serve(store: Arc<Store>) -> anyhow::Result<()> {
    let served = Arc::new(state::Served::default());
    let metrics = Arc::new(metrics::Metrics::default());
    let flush_every = Duration::from_secs(env_or("METRICS_FLUSH_SECS", "30").parse().unwrap_or(30));

    tokio::spawn(state::refresher(store.clone(), served.clone()));
    tokio::spawn(metrics::flusher(store.clone(), metrics.clone(), flush_every));
    tokio::spawn(metrics::housekeeping(store.clone()));

    let edge = env_or("EDGE_ENDPOINTS", "false") == "true";
    if edge {
        tracing::info!("Unleash Edge endpoints enabled");
    }
    let internal_token = std::env::var("INTERNAL_TOKEN").ok().filter(|t| !t.is_empty());
    if internal_token.is_none() {
        tracing::info!("INTERNAL_TOKEN unset: /internal/features is off");
    }
    let cache_secs: u64 = env_or("TOKEN_CACHE_SECS", "30")
        .parse()
        .map_err(|e| anyhow::anyhow!("TOKEN_CACHE_SECS must be a number of seconds: {e}"))?;
    let tokens = Arc::new(tokens::Tokens::new(Duration::from_secs(cache_secs)));
    let app = api::router(api::App { store, served, tokens, metrics, edge, internal_token })
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("x-unleash-version"),
            HeaderValue::from_static(concat!("flag-service/", env!("CARGO_PKG_VERSION"))),
        ))
        .layer(RequestBodyLimitLayer::new(1024 * 1024));

    let port: u16 = env_or("PORT", "4380").parse()?;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "flag-service listening");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}
