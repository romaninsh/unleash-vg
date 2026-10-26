// A rule in words: "ON", "OFF", "25%", "25% + 3 customers", "Only 2 customers".
// Shared by the default rule (default_rollout / rule_rollout) and brand overrides (rollout).
let rollout = if "rollout" in row { row.rollout }
    else if "rule_rollout" in row { row.rule_rollout }
    else { row.default_rollout };
let allow = if "allowlist" in row { row.allowlist }
    else if "rule_allowlist" in row { row.rule_allowlist }
    else { row.default_allowlist };
let n = if allow == () { 0 } else { allow.split(",").filter(|v| v != "").len() };
let customers = if n == 1 { "1 customer" } else { `${n} customers` };
if rollout == () { "" }
else if rollout >= 100 { "ON" }
else if rollout == 0 && n == 0 { "OFF" }
else if rollout == 0 { `Only ${customers}` }
else if n > 0 { `${rollout}% + ${customers}` }
else { `${rollout}%` }
