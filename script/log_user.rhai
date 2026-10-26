// Audit entry for a user change, from the desktop (`app_user`) or the web (`web_user_admin`).
// Passwords and their hashes are never logged: `new_password` stays out of `exclude:` so a reset
// (a write of nothing else) still reaches this script, and every branch below replaces or
// removes before/after. One write is one entry: a save that both deactivates someone and
// resets their password says both in its summary.
fn profile(r) {
    #{ name: r.name, email: r.email, role: r.role, editable_environments: r.editable_environments, active: r.active }
}

if change.action == "new" {
    let p = profile(row);
    p.remove("active");
    log.type = "user-created";
    log.summary = `User ${row.email} created as ${row.role}`;
    log.remove("before");
    log.after = p.to_json();
    true
} else if change.action == "delete" {
    log.type = "user-deleted";
    log.summary = `User ${row.email} deleted`;
    log.before = profile(row).to_json();
    log.remove("after");
    true
} else {
    let deactivated = before.active == true && after.active == false;
    // the web sends a new temporary password; the desktop sets the hash itself (only the desktop's
    // rows carry the hash, so compare it only when both sides have one)
    let reset = after.new_password != ()
        || (before.password_hash != () && after.password_hash != () && before.password_hash != after.password_hash);
    let was = profile(before);
    let now = profile(after);
    let changed = was.name != now.name || was.email != now.email || was.role != now.role
        || was.editable_environments != now.editable_environments || (now.active && !was.active);
    let parts = [];
    if changed { parts.push("updated"); }
    if deactivated { parts.push("deactivated"); }
    if reset { parts.push("password reset"); }
    if parts.is_empty() {
        false
    } else {
        if parts.len() > 1 {
            log.type = "user-updated";
            log.summary = `User ${now.email}: ${parts.reduce(|a, p| if a == "" { p } else { a + ", " + p }, "")}`;
        } else if changed {
            log.type = "user-updated";
            log.summary = `User ${now.email} updated`;
        } else if deactivated {
            log.type = "user-deactivated";
            log.summary = `User ${now.email} deactivated`;
        } else {
            log.type = "user-password-reset";
            log.summary = `Password reset for ${now.email}`;
        }
        if changed {
            log.before = was.to_json();
            log.after = now.to_json();
        } else {
            log.remove("before");
            log.remove("after");
        }
        true
    }
}
