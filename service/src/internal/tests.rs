use std::sync::Arc;

use axum::http::{HeaderMap, HeaderValue, header};
use serde_json::json;
use unleash_yggdrasil::EngineState;

use super::*;
use crate::state::{EnvSnapshot, Feature, Served};

fn served() -> Served {
    let served = Served::default();
    for (env, flags) in [("production", [("b-flag", true), ("a-flag", false)]), ("uat", [("a-flag", true), ("b-flag", true)])] {
        let features: Vec<Feature> = flags
            .iter()
            .map(|(name, switch)| Feature {
                name: (*name).into(),
                tags: vec![],
                switch: *switch,
                json: json!({ "name": name, "enabled": *switch, "strategies": [] }),
            })
            .collect();
        let names = features.iter().map(|f| f.name.clone()).collect();
        let snapshot = EnvSnapshot { revision: 1, features, names, engine: EngineState::initial_state(chrono::Utc::now()) };
        served.envs.write().unwrap().insert(env.into(), Arc::new(snapshot));
    }
    served
}

fn bearer(value: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(header::AUTHORIZATION, HeaderValue::from_str(value).unwrap());
    h
}

#[test]
fn every_served_feature_is_one_row_ordered_by_environment_then_flag() {
    let ids: Vec<_> = rows(&served(), None, None).iter().map(|r| r["id"].clone()).collect();
    assert_eq!(ids, vec![json!("a-flag@production"), json!("b-flag@production"), json!("a-flag@uat"), json!("b-flag@uat")]);
}

#[test]
fn a_row_carries_the_switch_what_is_served_and_the_feature_json() {
    let r = rows(&served(), Some("production"), Some("a-flag"));
    assert_eq!(
        r,
        vec![json!({
            "id": "a-flag@production", "flag_name": "a-flag", "env_key": "production",
            "enabled": false, "served_enabled": false,
            "feature": "{\"name\":\"a-flag\",\"enabled\":false,\"strategies\":[]}",
        })]
    );
}

#[test]
fn environment_and_flag_filters_narrow_the_rows() {
    assert_eq!(rows(&served(), Some("uat"), None).len(), 2);
    assert_eq!(rows(&served(), None, Some("b-flag")).len(), 2);
    assert!(rows(&served(), Some("development"), None).is_empty());
}

#[test]
fn only_the_configured_bearer_token_is_let_in() {
    assert!(authorized(&bearer("Bearer s3cret"), "s3cret"));
    assert!(!authorized(&bearer("Bearer other"), "s3cret"));
    assert!(!authorized(&bearer("s3cret"), "s3cret"));
    assert!(!authorized(&HeaderMap::new(), "s3cret"));
}
