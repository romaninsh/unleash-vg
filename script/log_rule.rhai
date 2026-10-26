// Audit entry for a rule change made through Vantage: an environment's switch and default rule
// (`flag_env`, `flag_env_edit`, `web_env_edit`) or a brand override (`brand_override`,
// `web_override_edit`). The overrides a web card save changes are written by the database inside
// that save, so the database logs those itself (tests/events.surql); Vantage never sees them.

// "ON", "OFF", "25%", "25% + 3 customers", "Only 2 customers" (as script/rule_label.rhai)
fn label(rollout, allow) {
    let n = `${allow ?? ""}`.split(",").filter(|v| v != "").len();
    let customers = if n == 1 { "1 customer" } else { `${n} customers` };
    if rollout == () { "" }
    else if rollout >= 100 { "ON" }
    else if rollout == 0 && n == 0 { "OFF" }
    else if rollout == 0 { `Only ${customers}` }
    else if n > 0 { `${rollout}% + ${customers}` }
    else { `${rollout}%` }
}

fn rule(rollout, allow) {
    #{ rollout: rollout, allowlist: `${allow ?? ""}`.split(",").filter(|v| v != "") }
}

// "flag_env:`name@env`" -> "name@env", "brand:bank-a" -> "bank-a"
fn key(id) {
    let s = `${id ?? ""}`;
    s = s.sub_string(s.index_of(":") + 1);
    s.replace("`", "");
    s.replace("⟨", "");
    s.replace("⟩", "");
    s
}

if change.table == "brand_override" || change.table == "web_override_edit" {
    let scope = `${row.scope ?? key(row.flag_env)}`;
    let at = scope.index_of("@");
    let flag = scope.sub_string(0, at);
    let env = scope.sub_string(at + 1);
    let brand_key = key(row.brand);
    let brand = table("brand").get(`${row.brand}`);
    let brand_name = if brand == () { brand_key } else { brand.display_name };
    log.flag = flag;
    log.environment = env;
    log.brand = brand_key;
    if change.action == "new" {
        // a new override without a rollout starts as a copy of the default rule (the database fills it)
        let stored = table("brand_override").get(change.id);
        let r = if stored == () { row } else { stored };
        log.type = "feature-brand-override-added";
        log.summary = `${env} - ${brand_name}: override added, ${label(r.rollout, r.allowlist)}`;
        log.remove("before");
        log.after = rule(r.rollout, r.allowlist).to_json();
        true
    } else if change.action == "delete" {
        log.type = "feature-brand-override-removed";
        log.summary = `${env} - ${brand_name}: override removed (was ${label(row.rollout, row.allowlist)}, now follows default)`;
        log.before = rule(row.rollout, row.allowlist).to_json();
        log.remove("after");
        true
    } else if before.rollout != after.rollout || (before.allowlist ?? "") != (after.allowlist ?? "") {
        log.type = "feature-brand-override-updated";
        log.summary = `${env} - ${brand_name}: ${label(before.rollout, before.allowlist)} -> ${label(after.rollout, after.allowlist)}`;
        log.before = rule(before.rollout, before.allowlist).to_json();
        log.after = rule(after.rollout, after.allowlist).to_json();
        true
    } else {
        false
    }
} else {
    // an environment: only edits count (the database creates and deletes them with their flag)
    if change.action != "edit" { return false; }
    let id = key(change.id);
    let at = id.index_of("@");
    let flag = id.sub_string(0, at);
    let env = id.sub_string(at + 1);
    log.flag = flag;
    log.environment = env;
    let switched = before.enabled != after.enabled;
    let ruled = before.default_rollout != after.default_rollout || (before.default_allowlist ?? "") != (after.default_allowlist ?? "");
    if !switched && !ruled { return false; }
    let switch_text = `switched ${if after.enabled { "ON" } else { "OFF" }}`;
    let rule_text = `Default: ${label(before.default_rollout, before.default_allowlist)} -> ${label(after.default_rollout, after.default_allowlist)}`;
    let was = #{};
    let now = #{};
    if switched { was.enabled = before.enabled; now.enabled = after.enabled; }
    if ruled {
        was.mixin(rule(before.default_rollout, before.default_allowlist));
        now.mixin(rule(after.default_rollout, after.default_allowlist));
    }
    if switched && ruled {
        log.type = "feature-environment-updated";
        log.summary = `${env} ${switch_text}, ${rule_text}`;
    } else if switched {
        log.type = if after.enabled { "feature-environment-enabled" } else { "feature-environment-disabled" };
        log.summary = `${env} ${switch_text}`;
    } else {
        log.type = "feature-default-rule-updated";
        log.summary = `${env} - ${rule_text}`;
    }
    log.before = was.to_json();
    log.after = now.to_json();
    true
}
