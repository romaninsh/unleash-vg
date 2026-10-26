//! What the service serves, kept in memory and refreshed from the database.
//!
//! Every `POLL` the refresher reads each environment's revision (spec 04: a global counter
//! stamped on the environments a change affects). When it moved, the environment's features
//! are compiled again by the database (`fn::compile`, spec 03) and loaded into a Yggdrasil
//! engine for the Frontend API. So every instance serves a change within a few seconds
//! (spec 09, "Availability"), and requests never wait on the database.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde_json::Value;
use unleash_types::client_features::{ClientFeature, ClientFeatures};
use unleash_yggdrasil::{EngineState, UpdateMessage};

use crate::store::{Store, surreal_expr};

pub const POLL: Duration = Duration::from_secs(2);

pub struct Feature {
    pub name: String,
    pub tags: Vec<String>,
    /// The ClientFeature JSON exactly as served by /api/client/features.
    pub json: Value,
}

pub struct EnvSnapshot {
    pub revision: i64,
    pub features: Vec<Feature>,
    pub names: HashSet<String>,
    pub engine: EngineState,
}

#[derive(Clone, Default)]
pub struct Settings {
    /// Allowed origins for the Frontend API; empty or containing "*" means any.
    pub cors_origins: Vec<String>,
}

#[derive(Default)]
pub struct Served {
    pub envs: RwLock<HashMap<String, Arc<EnvSnapshot>>>,
    pub settings: RwLock<Settings>,
}

impl Served {
    pub fn env(&self, env: &str) -> Option<Arc<EnvSnapshot>> {
        self.envs.read().expect("lock").get(env).cloned()
    }
}

/// Keep `served` current until the process ends.
pub async fn refresher(store: Arc<Store>, served: Arc<Served>) {
    loop {
        if let Err(e) = refresh_once(&store, &served).await {
            tracing::warn!(error = %e, "refresh failed; serving the last good state");
        }
        tokio::time::sleep(POLL).await;
    }
}

pub async fn refresh_once(store: &Store, served: &Served) -> anyhow::Result<()> {
    let revs = store.query(surreal_expr!("SELECT key, revision_id FROM environment")).await?;
    for row in revs.as_array().into_iter().flatten() {
        let (Some(env), Some(rev)) = (row["key"].as_str(), row["revision_id"].as_i64()) else { continue };
        if served.env(env).is_some_and(|s| s.revision == rev) {
            continue;
        }
        let snapshot = load_env(store, env, rev).await?;
        tracing::info!(env, revision = rev, flags = snapshot.features.len(), "environment loaded");
        served.envs.write().expect("lock").insert(env.to_string(), Arc::new(snapshot));
    }

    let s = store.query(surreal_expr!("SELECT frontend_cors_origins FROM ONLY settings:main")).await?;
    let origins = s["frontend_cors_origins"].as_str().unwrap_or("");
    let cors_origins = origins.split([',', ' ', '\n']).map(str::trim).filter(|o| !o.is_empty()).map(String::from).collect();
    *served.settings.write().expect("lock") = Settings { cors_origins };
    Ok(())
}

async fn load_env(store: &Store, env: &str, revision: i64) -> anyhow::Result<EnvSnapshot> {
    let env_key = env.to_string();
    let rows = store
        .query(surreal_expr!(
            "SELECT flag.name AS name, flag.tags AS tags, fn::compile(id) AS feature FROM flag_env \
             WHERE env_key = {} AND flag.archived != true ORDER BY name",
            env_key
        ))
        .await?;

    let mut features = Vec::new();
    let mut client_features = Vec::new();
    for row in rows.as_array().into_iter().flatten() {
        let name = row["name"].as_str().unwrap_or_default().to_string();
        let tags = row["tags"].as_str().unwrap_or("").split(',').filter(|t| !t.is_empty()).map(String::from).collect();
        let json = row["feature"].clone();
        let parsed: ClientFeature = serde_json::from_value(json.clone())
            .map_err(|e| anyhow::anyhow!("feature {name} doesn't parse as an Unleash ClientFeature: {e}"))?;
        client_features.push(parsed);
        features.push(Feature { name, tags, json });
    }

    let engine = EngineState::initial_state(chrono::Utc::now());
    let warnings = engine.take_state(UpdateMessage::FullResponse(ClientFeatures {
        version: 2,
        features: client_features,
        segments: None,
        query: None,
        meta: None,
    }));
    if let Some(w) = warnings.filter(|w| !w.is_empty()) {
        tracing::warn!(env, warnings = ?w.iter().map(|w| w.toggle_name.clone()).collect::<Vec<_>>(), "engine warnings");
    }

    let names = features.iter().map(|f| f.name.clone()).collect();
    Ok(EnvSnapshot { revision, features, names, engine })
}
