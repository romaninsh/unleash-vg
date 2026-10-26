//! API tokens (spec 04 "API tokens", "Common rules").
//!
//! Only argon2id hashes are stored. A token is found by `lookup` (its first 24 characters)
//! and checked against the hash. Checks are cached for `CACHE_TTL`, so argon2 runs once per
//! token per window; a revoked token stops working within that window. `last_used_at` is
//! written at most once a minute per token.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::store::{Store, surreal_expr};

const CACHE_TTL: Duration = Duration::from_secs(30);
const MISS_TTL: Duration = Duration::from_secs(5);
const USED_EVERY: Duration = Duration::from_secs(60);
pub const LOOKUP_LEN: usize = 24;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Backend,
    Frontend,
}

#[derive(Clone, Debug)]
pub struct Token {
    pub key: String,
    pub kind: Kind,
    pub environment: String,
}

struct Cached {
    token: Option<Token>,
    at: Instant,
}

#[derive(Default)]
pub struct Tokens {
    cache: Mutex<HashMap<String, Cached>>,
    used: Mutex<HashMap<String, Instant>>,
}

/// The secret from an `Authorization` header; a `Bearer ` prefix is accepted and stripped.
pub fn secret_from_header(value: &str) -> &str {
    let v = value.trim();
    v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")).unwrap_or(v).trim()
}

fn lookup_of(secret: &str) -> String {
    secret.chars().take(LOOKUP_LEN).collect()
}

impl Tokens {
    /// The token a secret belongs to, or None (unknown or revoked).
    pub async fn resolve(&self, store: &Arc<Store>, secret: &str) -> anyhow::Result<Option<Token>> {
        if secret.is_empty() {
            return Ok(None);
        }
        let cache_key = hex::encode(Sha256::digest(secret.as_bytes()));
        if let Some(c) = self.cache.lock().expect("lock").get(&cache_key) {
            let ttl = if c.token.is_some() { CACHE_TTL } else { MISS_TTL };
            if c.at.elapsed() < ttl {
                return Ok(c.token.clone());
            }
        }

        let lookup = lookup_of(secret);
        let rows = store
            .query(surreal_expr!(
                "SELECT record::id(id) AS key, type, record::id(environment) AS environment, secret_hash \
                 FROM api_token WHERE lookup = {}",
                lookup
            ))
            .await?;
        let candidates: Vec<Value> = rows.as_array().cloned().unwrap_or_default();
        let secret_owned = secret.to_string();
        // argon2 is deliberately slow: keep it off the async workers.
        let found = tokio::task::spawn_blocking(move || {
            candidates.into_iter().find_map(|row| {
                let hash = PasswordHash::new(row["secret_hash"].as_str()?).ok()?;
                Argon2::default().verify_password(secret_owned.as_bytes(), &hash).ok()?;
                Some(Token {
                    key: row["key"].as_str()?.to_string(),
                    kind: match row["type"].as_str()? {
                        "frontend" => Kind::Frontend,
                        _ => Kind::Backend, // "backend"; Unleash's legacy "client" is imported as backend
                    },
                    environment: row["environment"].as_str()?.to_string(),
                })
            })
        })
        .await?;

        self.cache.lock().expect("lock").insert(cache_key, Cached { token: found.clone(), at: Instant::now() });
        Ok(found)
    }

    /// Stamp `last_used_at`, at most once a minute per token, without delaying the request.
    pub fn mark_used(&self, store: &Arc<Store>, token: &Token) {
        {
            let mut used = self.used.lock().expect("lock");
            if used.get(&token.key).is_some_and(|t| t.elapsed() < USED_EVERY) {
                return;
            }
            used.insert(token.key.clone(), Instant::now());
        }
        let store = store.clone();
        let key = token.key.clone();
        tokio::spawn(async move {
            if let Err(e) = store
                .query(surreal_expr!("UPDATE type::record('api_token', {}) SET last_used_at = time::now() RETURN NONE", key))
                .await
            {
                tracing::warn!(error = %e, "could not stamp token last_used_at");
            }
        });
    }
}

/// An argon2id PHC hash, as the admin app (Vantage `hash_password`) stores them.
pub fn hash_secret(secret: &str) -> anyhow::Result<String> {
    let salt = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes()).map_err(|e| anyhow::anyhow!("salt: {e}"))?;
    Argon2::default()
        .hash_password(secret.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hashing failed: {e}"))
}

/// Store a token (a new secret, or an existing Unleash secret being imported; spec 09 step 3).
pub async fn save_token(store: &Store, name: &str, kind: &str, env: &str, secret: &str, source: &str) -> anyhow::Result<()> {
    let hash = hash_secret(secret)?;
    let lookup = lookup_of(secret);
    let hint = format!("{lookup}...");
    let (name, kind, env, source) = (name.to_string(), kind.to_string(), env.to_string(), source.to_string());
    store
        .query(surreal_expr!(
            "CREATE api_token SET name = {}, type = {}, environment = type::record('environment', {}), source = {}, \
             secret_hash = {}, lookup = {}, hint = {}, created_by = 'flag-service' RETURN NONE",
            name, kind, env, source, hash, lookup, hint
        ))
        .await?;
    Ok(())
}
