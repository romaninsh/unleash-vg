// Audit entry for a flag change, from the desktop (`flag`) or the web (`web_flag_edit`,
// `web_flag_delete`). Spec 07's event types; one write is one entry, so a save that changes
// two things (say a tag and the description) is a `feature-updated` naming both.
fn tags(r) {
    `${r.tags ?? ""}`.split(",").filter(|t| t != "")
}

log.flag = row.name;
if change.action == "new" {
    log.type = "feature-created";
    log.summary = `Flag ${row.name} created`;
    log.remove("before");
    log.after = #{ name: row.name, description: row.description, tags: row.tags }.to_json();
    true
} else if change.action == "delete" {
    log.type = "feature-deleted";
    log.summary = `${row.name} deleted permanently`;
    log.before = #{ name: row.name, description: row.description, tags: row.tags }.to_json();
    log.remove("after");
    true
} else {
    let old_tags = tags(before);
    let new_tags = tags(after);
    let added = new_tags.filter(|t| !old_tags.contains(t));
    let removed = old_tags.filter(|t| !new_tags.contains(t));
    let changes = [];   // [type, summary part, before map, after map]
    for t in added { changes.push(["feature-tagged", `tag "${t}" added`, #{}, #{ tag: t }]); }
    for t in removed { changes.push(["feature-untagged", `tag "${t}" removed`, #{ tag: t }, #{}]); }
    if (before.description ?? "") != (after.description ?? "") {
        changes.push(["feature-metadata-updated", "description changed", #{ description: before.description }, #{ description: after.description }]);
    }
    if before.stale != after.stale {
        changes.push([if after.stale { "feature-stale-on" } else { "feature-stale-off" },
                      if after.stale { "marked stale" } else { "no longer stale" }, #{}, #{}]);
    }
    if after.archived == true && before.archived != true {
        changes.push(["feature-archived", "archived", #{}, #{}]);
    }
    if after.archived != true && before.archived == true {
        changes.push(["feature-revived", "revived (all environments switched off)", #{}, #{}]);
    }
    if changes.is_empty() {
        false
    } else {
        let was = #{};
        let now = #{};
        for c in changes { was.mixin(c[2]); now.mixin(c[3]); }
        if changes.len() == 1 {
            let c = changes[0];
            log.type = c[0];
            // the old wording: "x: tag "t" added", "x: description changed", "x marked stale", "x archived"
            log.summary = if c[0] == "feature-tagged" || c[0] == "feature-untagged" || c[0] == "feature-metadata-updated" {
                `${row.name}: ${c[1]}`
            } else {
                `${row.name} ${c[1]}`
            };
        } else {
            log.type = "feature-updated";
            log.summary = `${row.name}: ${changes.map(|c| c[1]).reduce(|a, p| if a == "" { p } else { a + ", " + p }, "")}`;
        }
        if was.is_empty() { log.remove("before"); } else { log.before = was.to_json(); }
        if now.is_empty() { log.remove("after"); } else { log.after = now.to_json(); }
        true
    }
}
