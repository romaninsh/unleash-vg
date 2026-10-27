use serde_json::{Value, json};

use super::*;

fn contexts() -> Contexts {
    Contexts { brand: "brand".into(), customer: "userId".into() }
}

fn rule(rollout: i64, allowlist: &str) -> Rule {
    Rule { rollout, allowlist: allowlist.into() }
}

fn flag(name: &str, default: Rule, overrides: &[(&str, Rule)]) -> EnvFlag {
    EnvFlag {
        name: name.into(),
        description: Some("test".into()),
        stale: false,
        enabled: true,
        default,
        overrides: overrides.iter().map(|(b, r)| BrandRule { brand: (*b).into(), rule: r.clone() }).collect(),
    }
}

fn strategy(constraints: Value, rollout: &str, stickiness: &str, group: &str) -> Value {
    json!({ "name": "flexibleRollout", "constraints": constraints,
            "parameters": { "rollout": rollout, "stickiness": stickiness, "groupId": group }, "variants": [] })
}

fn constraint(field: &str, op: &str, values: &[&str]) -> Value {
    json!({ "contextName": field, "operator": op, "values": values, "inverted": false, "caseInsensitive": false })
}

#[test]
fn on_for_everyone_is_one_full_rollout() {
    let f = compile(&flag("ex1", rule(100, ""), &[]), &contexts());
    assert_eq!(
        f,
        json!({ "name": "ex1", "type": "release", "description": "test", "project": "default",
                "enabled": true, "stale": false, "impressionData": false,
                "strategies": [strategy(json!([]), "100", "default", "ex1")], "variants": [] })
    );
}

#[test]
fn brand_overrides_come_first_in_brand_order_then_the_default_for_everyone_else() {
    let f = compile(
        &flag("ex2", rule(100, ""), &[("bank-c", rule(10, "1001,1002")), ("bank-b", rule(0, ""))]),
        &contexts(),
    );
    assert_eq!(f["enabled"], json!(true));
    assert_eq!(
        f["strategies"],
        json!([
            strategy(json!([constraint("brand", "IN", &["bank-c"])]), "10", "userId", "ex2"),
            strategy(
                json!([constraint("brand", "IN", &["bank-c"]), constraint("userId", "IN", &["1001", "1002"])]),
                "100",
                "default",
                "ex2"
            ),
            strategy(json!([constraint("brand", "NOT_IN", &["bank-b", "bank-c"])]), "100", "default", "ex2"),
        ])
    );
}

#[test]
fn off_by_default_but_on_for_one_brand() {
    let f = compile(&flag("ex3", rule(0, ""), &[("bank-a", rule(100, ""))]), &contexts());
    assert_eq!(f["enabled"], json!(true));
    assert_eq!(
        f["strategies"],
        json!([strategy(json!([constraint("brand", "IN", &["bank-a"])]), "100", "default", "ex3")])
    );
}

#[test]
fn nothing_that_could_match_is_served_disabled() {
    let f = compile(&flag("ex4", rule(0, ""), &[]), &contexts());
    assert_eq!((f["enabled"].clone(), f["strategies"].clone()), (json!(false), json!([])));
}

#[test]
fn switch_off_serves_disabled_with_no_strategies() {
    let mut off = flag("ex1", rule(100, ""), &[]);
    off.enabled = false;
    let f = compile(&off, &contexts());
    assert_eq!((f["enabled"].clone(), f["strategies"].clone()), (json!(false), json!([])));
}

#[test]
fn settings_rename_the_context_fields() {
    let ctx = Contexts { brand: "tenant".into(), customer: "customerId".into() };
    let f = compile(&flag("ex2", rule(100, ""), &[("bank-c", rule(10, "1001"))]), &ctx);
    assert_eq!(f["strategies"][0]["constraints"][0]["contextName"], json!("tenant"));
    assert_eq!(f["strategies"][0]["parameters"]["stickiness"], json!("customerId"));
}

#[test]
fn a_flag_without_a_description_sends_null() {
    let mut f = flag("qqqq", rule(100, ""), &[]);
    f.description = None;
    assert_eq!(compile(&f, &contexts())["description"], Value::Null);
}
