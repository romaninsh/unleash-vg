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
    pub auth: AuthLevel,
}

/// The level `user` / `pass` sign in at: SurrealDB finds a user only at the level it was
/// defined (a SurrealDB Cloud database user is `Database`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthLevel {
    Root,
    Namespace,
    Database,
}

impl AuthLevel {
    /// `SURREAL_AUTH`'s value: `root` (also empty), `namespace` or `database`.
    pub fn from_env_value(value: &str) -> anyhow::Result<AuthLevel> {
        match value {
            "" | "root" => Ok(AuthLevel::Root),
            "namespace" => Ok(AuthLevel::Namespace),
            "database" => Ok(AuthLevel::Database),
            other => Err(anyhow!("SURREAL_AUTH must be root, namespace or database, not {other:?}")),
        }
    }
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
        let connection =
            SurrealConnection::new().url(&self.cfg.url).namespace(&self.cfg.namespace).database(&self.cfg.database);
        let (user, pass) = (&self.cfg.user, &self.cfg.pass);
        let connection = match self.cfg.auth {
            AuthLevel::Root => connection.auth_root(user, pass),
            AuthLevel::Namespace => connection.auth_namespace(user, pass),
            AuthLevel::Database => connection.auth_database(user, pass),
        };
        let client = tokio::time::timeout(QUERY_TIMEOUT, connection.connect())
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
