// Audit entry for a settings change, from the desktop (`settings`) or the web (`web_settings`).
// Only the five editable settings count; the database refuses deletes.
let fields = ["brand_context_field", "customer_context_field", "frontend_cors_origins", "metrics_retention_days", "unused_flag_days"];
if change.action != "edit" {
    false
} else {
    let was = #{};
    let now = #{};
    for f in fields {
        was[f] = before[f];
        now[f] = after[f];
    }
    if was.to_json() == now.to_json() {
        false
    } else {
        log.type = "settings-updated";
        log.summary = "Settings changed";
        log.before = was.to_json();
        log.after = now.to_json();
        true
    }
}
