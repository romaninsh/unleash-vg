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

DEFINE EVENT OVERWRITE brand_changes ON TABLE brand THEN {
    LET $by = $after.updated_by ?? $before.updated_by ?? $after.created_by ?? 'admin';
    -- keep a marker set on its own (the web app marks a brand just before deleting it)
    IF $event != 'DELETE' AND $after.updated_by != NONE
       AND ($event = 'CREATE' OR $before.display_name != $after.display_name OR $before.active != $after.active) {
        UPDATE $after.id SET updated_by = NONE;
    };
    IF $event = 'CREATE' {
        fn::audit($by, 'brand-created', NONE, NONE, $after.key,
            'Brand ' + $after.display_name + ' (' + $after.key + ') added', NONE,
            { key: $after.key, displayName: $after.display_name, active: $after.active });
    } ELSE IF $event = 'UPDATE' AND ($before.display_name != $after.display_name OR $before.active != $after.active) {
        fn::audit($by, 'brand-updated', NONE, NONE, $after.key,
            'Brand ' + $after.key + ': '
              + IF $before.display_name != $after.display_name THEN 'renamed "' + $before.display_name + '" -> "' + $after.display_name + '"' ELSE '' END
              + IF $before.display_name != $after.display_name AND $before.active != $after.active THEN ', ' ELSE '' END
              + IF $before.active != $after.active THEN IF $after.active THEN 'activated' ELSE 'deactivated' END ELSE '' END,
            { displayName: $before.display_name, active: $before.active },
            { displayName: $after.display_name, active: $after.active });
    } ELSE IF $event = 'DELETE' {
        IF count(SELECT id FROM brand_override WHERE brand = $before.id) > 0 {
            THROW 'This brand still has overrides - deactivate it instead';
        };
        fn::audit($by, 'brand-deleted', NONE, NONE, $before.key,
            'Brand ' + $before.display_name + ' (' + $before.key + ') deleted',
            { key: $before.key, displayName: $before.display_name }, NONE);
    };
};

-- ---------------------------------------------------------------- flags

DEFINE EVENT OVERWRITE flag_changes ON TABLE flag THEN {
    LET $by = $after.updated_by ?? $before.updated_by ?? 'admin';
    -- keep a marker set on its own (the web app marks a flag just before deleting it)
    IF $after.updated_by != NONE AND ($event = 'CREATE' OR $before.tags != $after.tags
        OR $before.description != $after.description OR $before.stale != $after.stale OR $before.archived != $after.archived) {
        UPDATE $after.id SET updated_by = NONE;
    };
    IF $event = 'CREATE' {
        IF record::id($after.id) != $after.name { THROW 'A flag record id must equal its name'; };
        -- every environment, switch OFF, default rule ON (spec 05: "New flag")
        FOR $e IN (SELECT * FROM environment) {
            CREATE type::record('flag_env', $after.name + '@' + $e.key) SET flag = $after.id, environment = $e.id;
        };
        fn::audit($by, 'feature-created', $after.name, NONE, NONE, 'Flag ' + $after.name + ' created', NONE,
            { name: $after.name, description: $after.description, tags: $after.tags });
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
        FOR $t IN array::complement($new, $old) {
            fn::audit($by, 'feature-tagged', $after.name, NONE, NONE, $after.name + ': tag "' + $t + '" added', NONE, { tag: $t });
        };
        FOR $t IN array::complement($old, $new) {
            fn::audit($by, 'feature-untagged', $after.name, NONE, NONE, $after.name + ': tag "' + $t + '" removed', { tag: $t }, NONE);
        };
        IF $before.description != $after.description {
            fn::audit($by, 'feature-metadata-updated', $after.name, NONE, NONE, $after.name + ': description changed',
                { description: $before.description }, { description: $after.description });
        };
        IF $before.stale != $after.stale {
            fn::audit($by, IF $after.stale THEN 'feature-stale-on' ELSE 'feature-stale-off' END, $after.name, NONE, NONE,
                $after.name + IF $after.stale THEN ' marked stale' ELSE ' no longer stale' END, NONE, NONE);
        };
        IF $after.archived AND !$before.archived {
            UPDATE $after.id SET archived_at = time::now(), archived_by = $by;
            fn::audit($by, 'feature-archived', $after.name, NONE, NONE, $after.name + ' archived', NONE, NONE);
        };
        IF !$after.archived AND $before.archived {
            -- revive: rules come back, every switch OFF (spec 05 screen 4)
            UPDATE $after.id SET archived_at = NONE, archived_by = NONE;
            UPDATE flag_env SET enabled = false, updated_by = $by WHERE flag = $after.id AND enabled = true;
            fn::audit($by, 'feature-revived', $after.name, NONE, NONE, $after.name + ' revived (all environments switched off)', NONE, NONE);
        };
        -- tags, description, stale and archive are all visible to SDKs
        fn::bump_revision(NONE);
        fn::refresh_flag($after.id);
    } ELSE IF $event = 'DELETE' {
        IF !$before.archived { THROW 'Only archived flags can be deleted permanently - archive it first'; };
        DELETE flag_env WHERE flag = $before.id;
        DELETE metric_hourly WHERE flag = $before.name;
        DELETE flag_last_seen WHERE flag = $before.name;
        fn::audit($by, 'feature-deleted', $before.name, NONE, NONE, $before.name + ' deleted permanently',
            { name: $before.name, description: $before.description, tags: $before.tags }, NONE);
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

DEFINE EVENT OVERWRITE settings_changes ON TABLE settings THEN {
    LET $by = $after.updated_by ?? 'admin';
    IF $event = 'DELETE' { THROW 'Settings cannot be deleted'; };
    IF $after.updated_by != NONE { UPDATE $after.id SET updated_by = NONE; };
    IF $event = 'UPDATE' AND $before.{brand_context_field, customer_context_field, frontend_cors_origins, metrics_retention_days, unused_flag_days}
                          != $after.{brand_context_field, customer_context_field, frontend_cors_origins, metrics_retention_days, unused_flag_days} {
        fn::audit($by, 'settings-updated', NONE, NONE, NONE, 'Settings changed',
            $before.{brand_context_field, customer_context_field, frontend_cors_origins, metrics_retention_days, unused_flag_days},
            $after.{brand_context_field, customer_context_field, frontend_cors_origins, metrics_retention_days, unused_flag_days});
        -- the context field names change the compiled output of every flag
        IF $before.brand_context_field != $after.brand_context_field OR $before.customer_context_field != $after.customer_context_field {
            fn::bump_revision(NONE);
        };
    };
};

-- ---------------------------------------------------------------- API tokens (secrets never logged)

DEFINE EVENT OVERWRITE api_token_changes ON TABLE api_token THEN {
    LET $by = $after.created_by ?? 'admin';
    -- the secret itself is never kept: only its hash, lookup and hint
    IF $event != 'DELETE' AND $after.new_secret != NONE { UPDATE $after.id SET new_secret = NONE; };
    IF $event = 'CREATE' {
        fn::audit($by, IF $after.source = 'imported' THEN 'api-token-imported' ELSE 'api-token-created' END, NONE,
            record::id($after.environment), NONE,
            record::id($after.environment) + ' - ' + $after.type + ' token "' + $after.name + '" '
                + IF $after.source = 'imported' THEN 'imported' ELSE 'created' END,
            NONE, { name: $after.name, type: $after.type, environment: record::id($after.environment) });
    } ELSE IF $event = 'DELETE' {
        fn::audit($before.updated_by ?? 'admin', 'api-token-deleted', NONE, record::id($before.environment), NONE,
            record::id($before.environment) + ' - ' + $before.type + ' token "' + $before.name + '" revoked',
            { name: $before.name, type: $before.type, environment: record::id($before.environment) }, NONE);
    };
};

-- ---------------------------------------------------------------- users

DEFINE EVENT OVERWRITE app_user_changes ON TABLE app_user THEN {
    LET $by = $after.updated_by ?? $before.updated_by ?? 'admin';
    -- There must always be an active admin (spec 07): no demoting, deactivating or deleting the last.
    IF ($event = 'UPDATE' AND $before.role = 'admin' AND $before.active AND ($after.role != 'admin' OR !$after.active))
       OR ($event = 'DELETE' AND $before.role = 'admin' AND $before.active) {
        IF count(SELECT id FROM app_user WHERE role = 'admin' AND active = true AND id != $before.id) = 0 {
            THROW 'At least one active admin is required';
        };
    };
    -- a temporary password is never kept: only its hash; the person marker is cleared once logged
    IF $event != 'DELETE' AND ($after.new_password != NONE OR $after.updated_by != NONE) {
        UPDATE $after.id SET new_password = NONE, updated_by = NONE;
    };
    -- when the password last changed (new user with a password, reset, or a change by the user)
    IF $event != 'DELETE' AND $after.password_hash != NONE AND ($event = 'CREATE' OR $before.password_hash != $after.password_hash) {
        UPDATE $after.id SET password_changed_at = time::now();
    };
    IF $event = 'CREATE' {
        fn::audit($by, 'user-created', NONE, NONE, NONE, 'User ' + $after.email + ' created as ' + $after.role, NONE,
            $after.{name, email, role, editable_environments});
    } ELSE IF $event = 'UPDATE' {
        IF $before.active AND !$after.active {
            fn::audit($by, 'user-deactivated', NONE, NONE, NONE, 'User ' + $after.email + ' deactivated', NONE, NONE);
        };
        IF $before.password_hash != $after.password_hash {
            fn::audit($by, 'user-password-reset', NONE, NONE, NONE, 'Password reset for ' + $after.email, NONE, NONE);
        };
        IF $before.name != $after.name OR $before.email != $after.email OR $before.role != $after.role
           OR $before.editable_environments != $after.editable_environments OR ($after.active AND !$before.active) {
            fn::audit($by, 'user-updated', NONE, NONE, NONE, 'User ' + $after.email + ' updated',
                $before.{name, email, role, editable_environments, active},
                $after.{name, email, role, editable_environments, active});
        };
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
