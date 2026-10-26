-- Flag Service rules that react to writes (spec 05, 07, 08). Load after schema.surql and the data.
-- A THROW inside an event cancels the write that fired it; the message is what the user sees.

-- Helper for audit payloads: a rule as {rollout, allowlist[]}.
DEFINE FUNCTION OVERWRITE fn::rule_json($rollout: option<int>, $allow: option<string>) -> object {
    RETURN { rollout: $rollout, allowlist: fn::list_items($allow) };
};

-- Before/after payloads are stored as JSON text. $by: who made the change (the web app sends
-- `updated_by` with each write; the desktop app sends nothing and is logged as 'admin').
DEFINE FUNCTION OVERWRITE fn::audit($by: string, $type: string, $flag: option<string>, $env: option<string>, $brand: option<string>,
                                    $summary: string, $pre: option<object>, $data: option<object>) {
    CREATE audit_event SET created_by = $by, type = $type, flag = $flag, environment = $env, brand = $brand, summary = $summary,
        pre_data = IF $pre = NONE THEN NONE ELSE encoding::json::encode($pre) END,
        data = IF $data = NONE THEN NONE ELSE encoding::json::encode($data) END;
};

-- ---------------------------------------------------------------- audit log is append-only

DEFINE EVENT OVERWRITE audit_immutable ON TABLE audit_event WHEN $event IN ['UPDATE', 'DELETE'] THEN {
    THROW 'Audit events cannot be changed or deleted';
};

-- ---------------------------------------------------------------- brands

-- Brand changes are audited by Vantage (table/brand.yaml log_changes:); this keeps the rule.
DEFINE EVENT OVERWRITE brand_changes ON TABLE brand WHEN $event = 'DELETE' THEN {
    IF count(SELECT id FROM brand_override WHERE brand = $before.id) > 0 {
        THROW 'This brand still has overrides - deactivate it instead';
    };
};

-- ---------------------------------------------------------------- flags

-- Flag changes are audited by Vantage (table/flag.yaml log_changes:); this keeps the rules, the
-- environments a new flag gets, the tag counts and the revision bumps.
DEFINE EVENT OVERWRITE flag_changes ON TABLE flag THEN {
    IF $event = 'CREATE' {
        IF record::id($after.id) != $after.name { THROW 'A flag record id must equal its name'; };
        -- every environment, switch OFF, default rule ON (spec 05: "New flag")
        FOR $e IN (SELECT * FROM environment) {
            CREATE type::record('flag_env', $after.name + '@' + $e.key) SET flag = $after.id, environment = $e.id;
        };
        IF !$after.archived { fn::count_tags(fn::list_items($after.tags), 1); };
        fn::bump_revision(NONE);
        fn::refresh_flag($after.id);
    } ELSE IF $event = 'UPDATE' AND ($before.tags != $after.tags OR $before.description != $after.description
                                      OR $before.stale != $after.stale OR $before.archived != $after.archived) {
        LET $old = fn::list_items($before.tags);
        LET $new = fn::list_items($after.tags);
        -- tag counts cover live flags only
        IF !$before.archived { fn::count_tags($old, -1); };
        IF !$after.archived { fn::count_tags($new, 1); };
        IF $after.archived AND !$before.archived {
            -- the web sends who archived it; the desktop sends nothing
            UPDATE $after.id SET archived_at = time::now(), archived_by = $after.archived_by ?? 'admin';
        };
        IF !$after.archived AND $before.archived {
            -- revive: rules come back, every switch OFF (spec 05 screen 4); the flag's own entry
            -- says so, so the switches going off aren't logged one by one
            UPDATE $after.id SET archived_at = NONE, archived_by = NONE;
            UPDATE flag_env SET enabled = false WHERE flag = $after.id AND enabled = true;
        };
        -- tags, description, stale and archive are all visible to SDKs
        fn::bump_revision(NONE);
        fn::refresh_flag($after.id);
    } ELSE IF $event = 'DELETE' {
        IF !$before.archived { THROW 'Only archived flags can be deleted permanently - archive it first'; };
        DELETE flag_env WHERE flag = $before.id;
        DELETE metric_hourly WHERE flag = $before.name;
        DELETE flag_last_seen WHERE flag = $before.name;
    };
};

-- ---------------------------------------------------------------- environment switch + default rule

DEFINE EVENT OVERWRITE flag_env_changes ON TABLE flag_env
WHEN $event = 'DELETE' OR ($event = 'UPDATE' AND ($before.enabled != $after.enabled
     OR $before.default_rollout != $after.default_rollout OR $before.default_allowlist != $after.default_allowlist
     OR $after.expected_revision != NONE OR $after.pending_overrides != NONE)) THEN {
    LET $by = $after.updated_by ?? $before.updated_by ?? 'admin';
    IF $event != 'DELETE' AND $after.updated_by != NONE { UPDATE $after.id SET updated_by = NONE; };
    IF $event = 'DELETE' {
        -- only as part of deleting the whole flag (the flag is already gone by then)
        IF record::exists($before.flag) { THROW 'A flag always has all its environments - delete the flag instead'; };
        DELETE brand_override WHERE flag_env = $before.id;
    } ELSE {
        LET $env = record::id($after.environment);
        LET $name = $after.flag.name;
        -- Concurrent edits (spec 05): refused when the card changed since the person opened it.
        -- The message starts "Changed by" - the web app recognises it and offers keep / discard.
        IF $after.expected_revision != NONE AND $after.expected_revision != $before.revision {
            LET $last = (SELECT created_by, created_at FROM audit_event
                         WHERE flag = $name AND environment = $env ORDER BY created_at DESC LIMIT 1)[0];
            THROW 'Changed by ' + ($last.created_by ?? 'someone') + ' at ' + <string> ($last.created_at ?? time::now())
                + ' - your edits were not saved';
        };
        IF $after.expected_revision != NONE OR $after.pending_overrides != NONE {
            UPDATE $after.id SET expected_revision = NONE, pending_overrides = NONE;
        };
        -- A whole-card save: make the brand overrides match the wanted set, in this transaction.
        IF $after.pending_overrides != NONE {
            LET $scope = $name + '@' + $env;
            LET $want = encoding::json::decode($after.pending_overrides);
            LET $have = SELECT id, brand.key AS key, rollout, allowlist FROM brand_override WHERE scope = $scope;
            FOR $h IN $have {
                IF $h.key NOT IN $want.brand { UPDATE $h.id SET updated_by = $by; DELETE $h.id; };
            };
            FOR $w IN $want {
                LET $cur = array::first(array::filter($have, |$h| $h.key = $w.brand));
                IF $cur = NONE {
                    CREATE brand_override SET scope = $scope, brand = type::record('brand', $w.brand),
                        rollout = $w.rollout, allowlist = $w.allowlist ?? '', updated_by = $by;
                } ELSE IF $cur.rollout != $w.rollout OR $cur.allowlist != fn::norm_list($w.allowlist ?? '') {
                    UPDATE $cur.id SET rollout = $w.rollout, allowlist = $w.allowlist ?? '', updated_by = $by;
                };
            };
        };
        IF $before.enabled != $after.enabled OR $before.default_rollout != $after.default_rollout
           OR $before.default_allowlist != $after.default_allowlist {
            UPDATE $after.id SET revision += 1;
            IF $before.enabled != $after.enabled {
                fn::audit($by, IF $after.enabled THEN 'feature-environment-enabled' ELSE 'feature-environment-disabled' END,
                    $name, $env, NONE, $env + ' switched ' + IF $after.enabled THEN 'ON' ELSE 'OFF' END,
                    { enabled: $before.enabled }, { enabled: $after.enabled });
            };
            IF $before.default_rollout != $after.default_rollout OR $before.default_allowlist != $after.default_allowlist {
                fn::audit($by, 'feature-default-rule-updated', $name, $env, NONE,
                    $env + ' - Default: ' + fn::rule_label($before.default_rollout, $before.default_allowlist)
                         + ' -> ' + fn::rule_label($after.default_rollout, $after.default_allowlist),
                    fn::rule_json($before.default_rollout, $before.default_allowlist),
                    fn::rule_json($after.default_rollout, $after.default_allowlist));
            };
            fn::bump_revision($after.environment);
            fn::refresh_flag($after.flag);
        };
    };
};

-- ---------------------------------------------------------------- brand overrides

DEFINE EVENT OVERWRITE brand_override_changes ON TABLE brand_override THEN {
    LET $by = $after.updated_by ?? $before.updated_by ?? 'admin';
    -- keep a marker set on its own (the web app marks an override just before removing it)
    IF $after.updated_by != NONE AND ($event = 'CREATE' OR $before.rollout != $after.rollout OR $before.allowlist != $after.allowlist) {
        UPDATE $after.id SET updated_by = NONE;
    };
    IF $event = 'CREATE' {
        IF !$after.brand.active { THROW 'This brand is inactive - activate it before adding overrides'; };
        LET $fe = $after.flag_env;
        -- a new override starts as a copy of the default rule unless a rollout was given
        UPDATE $after.id SET ready = true,
            rollout = $after.rollout ?? $fe.default_rollout,
            allowlist = IF $after.rollout = NONE THEN $fe.default_allowlist ELSE $after.allowlist END;
        LET $cur = (SELECT * FROM ONLY $after.id);
        fn::audit($by, 'feature-brand-override-added', $fe.flag.name, record::id($fe.environment), $after.brand.key,
            record::id($fe.environment) + ' - ' + $after.brand.display_name + ': override added, ' + fn::rule_label($cur.rollout, $cur.allowlist),
            NONE, fn::rule_json($cur.rollout, $cur.allowlist));
        UPDATE $fe SET revision += 1, touched_at = time::now();
        fn::bump_revision($fe.environment);
        fn::refresh_flag($fe.flag);
    } ELSE IF $event = 'UPDATE' AND $before.ready AND ($before.rollout != $after.rollout OR $before.allowlist != $after.allowlist) {
        LET $fe = $after.flag_env;
        fn::audit($by, 'feature-brand-override-updated', $fe.flag.name, record::id($fe.environment), $after.brand.key,
            record::id($fe.environment) + ' - ' + $after.brand.display_name + ': '
                + fn::rule_label($before.rollout, $before.allowlist) + ' -> ' + fn::rule_label($after.rollout, $after.allowlist),
            fn::rule_json($before.rollout, $before.allowlist), fn::rule_json($after.rollout, $after.allowlist));
        UPDATE $fe SET revision += 1, touched_at = time::now();
        fn::bump_revision($fe.environment);
        fn::refresh_flag($fe.flag);
    } ELSE IF $event = 'DELETE' AND $before.flag_env.id != NONE {
        -- skipped when the whole flag is being deleted (its flag_env row is already gone)
        LET $fe = $before.flag_env;
        fn::audit($by, 'feature-brand-override-removed', $fe.flag.name, record::id($fe.environment), $before.brand.key,
            record::id($fe.environment) + ' - ' + ($before.brand.display_name ?? <string> record::id($before.brand))
                + ': override removed (was ' + fn::rule_label($before.rollout, $before.allowlist) + ', now follows default)',
            fn::rule_json($before.rollout, $before.allowlist), NONE);
        UPDATE $fe SET revision += 1, touched_at = time::now();
        fn::bump_revision($fe.environment);
        fn::refresh_flag($fe.flag);
    };
};

-- ---------------------------------------------------------------- settings

-- Settings changes are audited by Vantage (table/settings.yaml log_changes:); this keeps the rules.
DEFINE EVENT OVERWRITE settings_changes ON TABLE settings THEN {
    IF $event = 'DELETE' { THROW 'Settings cannot be deleted'; };
    -- the context field names change the compiled output of every flag
    IF $event = 'UPDATE' AND ($before.brand_context_field != $after.brand_context_field
                              OR $before.customer_context_field != $after.customer_context_field) {
        fn::bump_revision(NONE);
    };
};

-- ---------------------------------------------------------------- API tokens (secrets never logged)

-- Token changes are audited by Vantage (table/api_token.yaml log_changes:, secrets excluded).
DEFINE EVENT OVERWRITE api_token_changes ON TABLE api_token WHEN $event != 'DELETE' THEN {
    -- the secret itself is never kept: only its hash, lookup and hint
    IF $after.new_secret != NONE { UPDATE $after.id SET new_secret = NONE; };
};

-- ---------------------------------------------------------------- users

-- User changes are audited by Vantage (table/app_user.yaml log_changes:); this keeps the rules.
DEFINE EVENT OVERWRITE app_user_changes ON TABLE app_user THEN {
    -- There must always be an active admin (spec 07): no demoting, deactivating or deleting the last.
    IF ($event = 'UPDATE' AND $before.role = 'admin' AND $before.active AND ($after.role != 'admin' OR !$after.active))
       OR ($event = 'DELETE' AND $before.role = 'admin' AND $before.active) {
        IF count(SELECT id FROM app_user WHERE role = 'admin' AND active = true AND id != $before.id) = 0 {
            THROW 'At least one active admin is required';
        };
    };
    -- a temporary password is never kept: only its hash
    IF $event != 'DELETE' AND $after.new_password != NONE {
        UPDATE $after.id SET new_password = NONE;
    };
    -- when the password last changed (new user with a password, reset, or a change by the user)
    IF $event != 'DELETE' AND $after.password_hash != NONE AND ($event = 'CREATE' OR $before.password_hash != $after.password_hash) {
        UPDATE $after.id SET password_changed_at = time::now();
    };
};

-- One-off after loading data (seed or import): fill every flag's list summary and the tag
-- counts, and date usage recording from the oldest usage bucket when it predates the setting.
FOR $f IN (SELECT VALUE id FROM flag) { fn::refresh_flag($f); };
fn::rebuild_tags();
UPDATE settings:main SET usage_recording_since =
    (SELECT VALUE hour FROM metric_hourly ORDER BY hour LIMIT 1)[0] ?? time::now()
    WHERE usage_recording_since = NONE;

-- ---------------------------------------------------------------- usage touches the flag row (live lists)

DEFINE EVENT OVERWRITE flag_last_seen_touch ON TABLE flag_last_seen WHEN $event IN ['CREATE', 'UPDATE'] THEN {
    fn::refresh_flag(type::record('flag', $after.flag));
};
