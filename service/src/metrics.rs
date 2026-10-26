//! Usage metrics and connected apps (spec 08). Posts are validated and added to an in-memory
//! buffer; a flusher writes it every `flush_every` (spec: at most 30 s; losing one buffer on a
//! crash is acceptable). "Seen" = yes + no > 0; last seen is the time the server processed it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Timelike, Utc};
use serde::Deserialize;
use serde_json::Value;

use crate::state::Served;
use crate::store::{Store, surreal_expr};

#[derive(Debug, Deserialize)]
pub struct ToggleCount {
    #[serde(default)]
    pub yes: i64,
    #[serde(default)]
    pub no: i64,
}

#[derive(Debug, Deserialize)]
pub struct Bucket {
    #[serde(default)]
    pub toggles: HashMap<String, ToggleCount>,
}

/// Body of POST /api/client/metrics and /api/frontend/client/metrics (client-metrics-schema).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsPost {
    pub app_name: String,
    #[serde(default)]
    pub instance_id: Option<String>,
    #[serde(default)]
    pub sdk_version: Option<String>,
    pub bucket: Bucket,
}

/// Body of the register endpoints (client-application-schema; loose: only appName required).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPost {
    pub app_name: String,
    #[serde(default)]
    pub instance_id: Option<String>,
    #[serde(default)]
    pub sdk_version: Option<String>,
}

/// One row of a bulk post's `metrics[]` (bulk-metrics-schema).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkMetric {
    pub feature_name: String,
    pub app_name: String,
    pub environment: String,
    #[serde(default)]
    pub yes: i64,
    #[serde(default)]
    pub no: i64,
}

#[derive(Debug, Deserialize)]
pub struct BulkPost {
    #[serde(default)]
    pub applications: Vec<Value>,
    #[serde(default)]
    pub metrics: Vec<BulkMetric>,
}

#[derive(Default)]
struct Buffer {
    /// (flag, env, app, hour) -> (yes, no)
    hourly: HashMap<(String, String, String, String), (i64, i64)>,
    /// (flag, env) seen
    seen: HashMap<(String, String), ()>,
    /// (name, env, app) -> evaluations of names that don't exist
    unknown: HashMap<(String, String, String), i64>,
    /// (app, env, instance) -> sdk version
    apps: HashMap<(String, String, String), Option<String>>,
}

#[derive(Default)]
pub struct Metrics {
    buf: Mutex<Buffer>,
}

// Abuse limits (spec 08: a misbehaving or hostile app must not fill the database). Per flush,
// new keys beyond these are dropped (keys already in the buffer keep counting); the database
// side has ceilings too (see `flush`). Text from apps is clipped; counts are capped.
const MAX_TEXT: usize = 200;
const MAX_COUNT: i64 = 1_000_000_000;
const MAX_HOURLY_KEYS: usize = 50_000;
const MAX_UNKNOWN_KEYS: usize = 5_000;
const MAX_APP_KEYS: usize = 2_000;
/// Rows one environment may hold in the database.
pub const MAX_UNKNOWN_ROWS_PER_ENV: i64 = 5_000;
pub const MAX_UNKNOWN_ROWS_PER_APP: i64 = 1_000;
pub const MAX_APP_ROWS_PER_ENV: i64 = 2_000;

fn clip(s: &str) -> String {
    s.chars().take(MAX_TEXT).collect()
}

fn hour_of(t: DateTime<Utc>) -> String {
    t.with_minute(0).and_then(|t| t.with_second(0)).and_then(|t| t.with_nanosecond(0)).expect("valid").to_rfc3339()
}

impl Metrics {
    pub fn app(&self, app: &str, env: &str, instance: Option<&str>, sdk: Option<&str>) {
        let key = (clip(app), env.to_string(), clip(instance.unwrap_or("default")));
        // A metrics post often carries no sdkVersion: keep the one a register call gave.
        let mut b = self.buf.lock().expect("lock");
        if !b.apps.contains_key(&key) && b.apps.len() >= MAX_APP_KEYS {
            return;
        }
        let entry = b.apps.entry(key).or_default();
        if sdk.is_some() {
            *entry = sdk.map(clip);
        }
    }

    /// Count one app's evaluations of flags in `env`. Names `served` doesn't know are "unknown".
    pub fn count(&self, served: &Served, env: &str, app: &str, counts: impl IntoIterator<Item = (String, i64, i64)>) {
        let known = served.env(env);
        let hour = hour_of(Utc::now());
        let app = clip(app);
        let mut b = self.buf.lock().expect("lock");
        for (flag, yes, no) in counts {
            let (yes, no) = (yes.clamp(0, MAX_COUNT), no.clamp(0, MAX_COUNT));
            if yes + no <= 0 {
                continue;
            }
            if known.as_ref().is_some_and(|s| s.names.contains(&flag)) {
                let key = (flag.clone(), env.to_string(), app.clone(), hour.clone());
                if !b.hourly.contains_key(&key) && b.hourly.len() >= MAX_HOURLY_KEYS {
                    continue;
                }
                let e = b.hourly.entry(key).or_default();
                e.0 = (e.0 + yes).min(MAX_COUNT);
                e.1 = (e.1 + no).min(MAX_COUNT);
                b.seen.insert((flag, env.to_string()), ());
            } else {
                let key = (clip(&flag), env.to_string(), app.clone());
                if !b.unknown.contains_key(&key) && b.unknown.len() >= MAX_UNKNOWN_KEYS {
                    continue;
                }
                let n = b.unknown.entry(key).or_default();
                *n = (*n + yes + no).min(MAX_COUNT);
            }
        }
    }

    fn take(&self) -> Buffer {
        std::mem::take(&mut *self.buf.lock().expect("lock"))
    }
}

/// Write the buffer every `every`, until the process ends.
pub async fn flusher(store: Arc<Store>, metrics: Arc<Metrics>, every: Duration) {
    loop {
        tokio::time::sleep(every).await;
        if let Err(e) = flush(&store, &metrics).await {
            tracing::warn!(error = %e, "metrics flush failed (the buffer is dropped, as spec 08 allows)");
        }
    }
}

pub async fn flush(store: &Store, metrics: &Metrics) -> anyhow::Result<()> {
    let b = metrics.take();
    for ((flag, env, app, hour), (yes, no)) in b.hourly {
        let key = format!("{flag}|{env}|{app}|{hour}");
        store
            .query(surreal_expr!(
                "UPSERT type::record('metric_hourly', {}) SET flag = {}, environment = {}, app_name = {}, \
                 hour = <datetime>{}, yes = (yes ?? 0) + {}, no = (no ?? 0) + {} RETURN NONE",
                key, flag, env, app, hour, yes, no
            ))
            .await?;
    }
    for ((flag, env), ()) in b.seen {
        let key = format!("{flag}:{env}");
        store
            .query(surreal_expr!(
                "UPSERT type::record('flag_last_seen', {}) SET flag = {}, environment = {}, last_seen_at = time::now() RETURN NONE",
                key, flag, env
            ))
            .await?;
    }
    // New unknown names and apps only while the environment (and app) is under its ceiling;
    // rows that already exist always update.
    // surreal_expr! takes each argument by value, as one token: hence the copies below.
    let (max_env, max_app, max_apps, max_count) = (MAX_UNKNOWN_ROWS_PER_ENV, MAX_UNKNOWN_ROWS_PER_APP, MAX_APP_ROWS_PER_ENV, MAX_COUNT);
    for ((name, env, app), n) in b.unknown {
        let key = format!("{name}|{env}|{app}");
        let (key2, env2, env3, app2) = (key.clone(), env.clone(), env.clone(), app.clone());
        store
            .query(surreal_expr!(
                "IF record::exists(type::record('unknown_flag', {})) \
                    OR (count(SELECT id FROM unknown_flag WHERE environment = {}) < {} \
                        AND count(SELECT id FROM unknown_flag WHERE environment = {} AND app_name = {}) < {}) { \
                 UPSERT type::record('unknown_flag', {}) SET name = {}, environment = {}, app_name = {}, \
                 last_seen_at = time::now(), count = math::min([(count ?? 0) + {}, {}]) RETURN NONE }",
                key2, env2, max_env, env3, app2, max_app, key, name, env, app, n, max_count
            ))
            .await?;
    }
    for ((app, env, instance), sdk) in b.apps {
        let key = format!("{app}|{env}|{instance}");
        let sdk = sdk.unwrap_or_default();
        let (key2, env2, sdk_again) = (key.clone(), env.clone(), sdk.clone());
        store
            .query(surreal_expr!(
                "IF record::exists(type::record('client_app', {})) \
                    OR count(SELECT id FROM client_app WHERE environment = {}) < {} { \
                 UPSERT type::record('client_app', {}) SET app_name = {}, environment = {}, instance_id = {}, \
                 sdk_version = IF {} = '' THEN sdk_version ELSE {} END, last_seen_at = time::now() RETURN NONE }",
                key2, env2, max_apps, key, app, env, instance, sdk, sdk_again
            ))
            .await?;
    }
    Ok(())
}

/// Hourly: drop metric buckets past `settings.metrics_retention_days`, unknown names and
/// connected apps not seen for 7 days (spec 08, "Stored data").
pub async fn housekeeping(store: Arc<Store>) {
    loop {
        for sql in [
            "DELETE metric_hourly WHERE hour < time::now() - duration::from_days(settings:main.metrics_retention_days)",
            "DELETE unknown_flag WHERE last_seen_at < time::now() - 7d",
            "DELETE client_app WHERE last_seen_at < time::now() - 7d",
        ] {
            if let Err(e) = store.query(surreal_expr!(sql)).await {
                tracing::warn!(error = %e, sql, "housekeeping failed");
            }
        }
        tokio::time::sleep(Duration::from_secs(3600)).await;
    }
}
