// Audit entry for an API token change, from the desktop (`api_token`) or the web
// (`web_token_admin`). Only its name, type and environment are logged, never the secret.
let env = `${row.environment ?? ""}`;
env = env.sub_string(env.index_of(":") + 1);   // stored as the record id environment:<key>
let token = #{ name: row.name, type: row.type, environment: env };
log.environment = env;
if change.action == "new" {
    let imported = row.source == "imported";
    log.type = if imported { "api-token-imported" } else { "api-token-created" };
    log.summary = `${env} - ${row.type} token "${row.name}" ${if imported { "imported" } else { "created" }}`;
    log.remove("before");
    log.after = token.to_json();
    true
} else if change.action == "delete" {
    log.type = "api-token-deleted";
    log.summary = `${env} - ${row.type} token "${row.name}" revoked`;
    log.before = token.to_json();
    log.remove("after");
    true
} else {
    false
}
