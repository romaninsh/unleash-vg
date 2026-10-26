//! Database access through the Vantage framework (vantage-surrealdb + surreal-client).
//!
//! One connection, reconnected on failure: the framework's client has no reconnect or
//! keepalive, so every call has a timeout and a failed call drops the connection for the next
//! call to re-open. Requests are served from memory (see `state.rs`); the database is read by
//! background refreshes and written by the metrics flush, so one connection is enough.

use std::time::Duration;

use anyhow::{Context as _, anyhow};
use serde_json::Value;
use surreal_client::SurrealConnection;
use tokio::sync::Mutex;
use vantage_expressions::{ExprDataSource, Expression};
use vantage_surrealdb::{AnySurrealType, surrealdb::SurrealDB};

pub use vantage_surrealdb::surreal_expr;

pub type Expr = Expression<AnySurrealType>;

#[derive(Clone, Debug)]
pub struct DbConfig {
    pub url: String,
    pub namespace: String,
    pub database: String,
    pub user: String,
    pub pass: String,
}

pub struct Store {
    cfg: DbConfig,
    db: Mutex<Option<SurrealDB>>,
}

const QUERY_TIMEOUT: Duration = Duration::from_secs(10);

impl Store {
    pub fn new(cfg: DbConfig) -> Self {
        Self { cfg, db: Mutex::new(None) }
    }

    async fn connect(&self) -> anyhow::Result<SurrealDB> {
        let client = tokio::time::timeout(
            QUERY_TIMEOUT,
            SurrealConnection::new()
                .url(&self.cfg.url)
                .namespace(&self.cfg.namespace)
                .database(&self.cfg.database)
                .auth_root(&self.cfg.user, &self.cfg.pass)
                .connect(),
        )
        .await
        .context("connecting to SurrealDB timed out")?
        .map_err(|e| anyhow!("connecting to SurrealDB: {e}"))?;
        tracing::info!(url = %self.cfg.url, "connected to SurrealDB");
        Ok(SurrealDB::new(client))
    }

    /// Run one SurrealQL statement and return its result as JSON.
    pub async fn query(&self, expr: Expr) -> anyhow::Result<Value> {
        let mut guard = self.db.lock().await;
        if guard.is_none() {
            *guard = Some(self.connect().await?);
        }
        let db = guard.as_ref().expect("connected above").clone();
        match tokio::time::timeout(QUERY_TIMEOUT, db.execute(&expr)).await {
            Ok(Ok(v)) => Ok(Value::from(v)),
            Ok(Err(e)) => {
                let msg = format!("{e:?}");
                // A statement error (bad data, THROW) leaves the connection usable;
                // anything else may mean the socket is gone.
                if !msg.contains("query_execution") {
                    *guard = None;
                }
                Err(anyhow!("SurrealDB: {msg}"))
            }
            Err(_) => {
                *guard = None;
                Err(anyhow!("SurrealDB query timed out"))
            }
        }
    }
}
