//! What SDKs receive for one flag in one environment (spec 03).

use serde_json::{Value, json};

/// The context field names apps send (Settings): the brand, and the customer that rollouts
/// stick to and allowlists name.
pub struct Contexts {
    pub brand: String,
    pub customer: String,
}

#[derive(Clone)]
pub struct Rule {
    pub rollout: i64,
    /// Comma-separated customer ids, as the database keeps it.
    pub allowlist: String,
}

pub struct BrandRule {
    pub brand: String,
    pub rule: Rule,
}

pub struct EnvFlag {
    pub name: String,
    pub description: Option<String>,
    pub stale: bool,
    pub enabled: bool,
    pub default: Rule,
    pub overrides: Vec<BrandRule>,
}

/// One Unleash ClientFeature of standard `flexibleRollout` strategies: each overridden brand
/// in key order, then the default rule scoped NOT_IN those brands. Served disabled with no
/// strategies when the switch is off or nothing would match (spec 03 "Why these choices").
pub fn compile(flag: &EnvFlag, ctx: &Contexts) -> Value {
    let mut overrides: Vec<&BrandRule> = flag.overrides.iter().collect();
    overrides.sort_by(|a, b| a.brand.cmp(&b.brand));

    let mut strategies = Vec::new();
    for o in &overrides {
        emit(&mut strategies, &o.rule, vec![constraint(&ctx.brand, "IN", vec![o.brand.as_str()])], &flag.name, ctx);
    }
    let others = if overrides.is_empty() {
        vec![]
    } else {
        vec![constraint(&ctx.brand, "NOT_IN", overrides.iter().map(|o| o.brand.as_str()).collect())]
    };
    emit(&mut strategies, &flag.default, others, &flag.name, ctx);

    let on = flag.enabled && !strategies.is_empty();
    json!({
        "name": flag.name, "type": "release", "description": flag.description, "project": "default",
        "enabled": on, "stale": flag.stale, "impressionData": false,
        "strategies": if on { strategies } else { vec![] }, "variants": [],
    })
}

/// A rule's strategies within `scope`: the rollout share, then its allowlisted customers.
fn emit(out: &mut Vec<Value>, rule: &Rule, scope: Vec<Value>, group: &str, ctx: &Contexts) {
    if rule.rollout > 0 {
        let stickiness = if rule.rollout == 100 { "default" } else { ctx.customer.as_str() };
        out.push(strategy(scope.clone(), &rule.rollout.to_string(), stickiness, group));
    }
    let ids: Vec<&str> = rule.allowlist.split(',').filter(|v| !v.is_empty()).collect();
    if rule.rollout < 100 && !ids.is_empty() {
        let mut constraints = scope;
        constraints.push(constraint(&ctx.customer, "IN", ids));
        out.push(strategy(constraints, "100", "default", group));
    }
}

fn strategy(constraints: Vec<Value>, rollout: &str, stickiness: &str, group: &str) -> Value {
    json!({
        "name": "flexibleRollout", "constraints": constraints,
        "parameters": { "rollout": rollout, "stickiness": stickiness, "groupId": group }, "variants": [],
    })
}

fn constraint(field: &str, op: &str, values: Vec<&str>) -> Value {
    json!({ "contextName": field, "operator": op, "values": values, "inverted": false, "caseInsensitive": false })
}

#[cfg(test)]
mod tests;
