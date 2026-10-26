// Audit entry for a brand change, from the desktop (`brand`) or the web (`web_brand_admin`).
// Event types and summaries as spec 07 lists them; an edit that neither renames nor
// (de)activates writes no entry.
log.brand = row.key;
if change.action == "new" {
    log.type = "brand-created";
    log.summary = `Brand ${row.display_name} (${row.key}) added`;
    log.after = #{ key: row.key, displayName: row.display_name, active: row.active }.to_json();
    true
} else if change.action == "delete" {
    log.type = "brand-deleted";
    log.summary = `Brand ${row.display_name} (${row.key}) deleted`;
    log.before = #{ key: row.key, displayName: row.display_name }.to_json();
    true
} else {
    let renamed = before.display_name != after.display_name;
    let toggled = before.active != after.active;
    if renamed || toggled {
        let parts = [];
        if renamed { parts.push(`renamed "${before.display_name}" -> "${after.display_name}"`); }
        if toggled { parts.push(if after.active { "activated" } else { "deactivated" }); }
        log.type = "brand-updated";
        log.summary = `Brand ${row.key}: ${parts.reduce(|a, p| if a == "" { p } else { a + ", " + p }, "")}`;
        log.before = #{ displayName: before.display_name, active: before.active }.to_json();
        log.after = #{ displayName: after.display_name, active: after.active }.to_json();
        true
    } else {
        false
    }
}
