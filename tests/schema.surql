-- Flag Service admin database on SurrealDB (spec: ../spec/02, 03, 04, 07, 08).
-- Load order: schema.surql -> seed.surql (or a data import) -> events.surql.
-- Events load last so importing existing rows doesn't create audit entries or environments.
-- Every statement is re-runnable (OVERWRITE).

-- ================================================================ helper functions

-- Tidy a list typed by a person: split on commas, semicolons and whitespace, drop empties and
-- duplicates (first one wins), join with commas. "7 8\n8;9" -> "7,8,9".
DEFINE FUNCTION OVERWRITE fn::norm_list($s: option<string>) -> string {
    LET $t = string::replace(string::replace(string::replace(string::replace(string::replace(
        $s ?? '', '\n', ','), '\r', ','), '\t', ','), ' ', ','), ';', ',');
    RETURN array::join(array::distinct(array::filter(string::split($t, ','), |$v| $v != '')), ',');
};

DEFINE FUNCTION OVERWRITE fn::list_items($s: option<string>) -> array<string> {
    RETURN array::filter(string::split($s ?? '', ','), |$v| $v != '');
};

-- An allowlist is valid when it has at most 1000 IDs of 1-100 characters.
DEFINE FUNCTION OVERWRITE fn::allowlist_ok($s: option<string>) -> bool {
    LET $items = fn::list_items($s);
    RETURN array::len($items) <= 1000 AND array::len(array::filter($items, |$v| string::len($v) > 100)) = 0;
};

-- Tags: lowercase, a-z 0-9 : _ -, up to 50 characters each.
DEFINE FUNCTION OVERWRITE fn::tags_ok($s: option<string>) -> bool {
    RETURN array::len(array::filter(fn::list_items($s), |$v| !string::matches($v, '^[a-z0-9:_-]{1,50}$'))) = 0;
};

-- "ON" / "OFF" / "25%" / "10% + 2 customers" / "Only 3 customers" (spec 02, presentation).
DEFINE FUNCTION OVERWRITE fn::rule_label($rollout: option<int>, $allow: option<string>) -> string {
    LET $n = array::len(fn::list_items($allow));
    LET $c = <string> $n + IF $n = 1 THEN ' customer' ELSE ' customers' END;
    RETURN IF $rollout = NONE THEN ''
        ELSE IF $rollout >= 100 THEN 'ON'
        ELSE IF $rollout = 0 AND $n = 0 THEN 'OFF'
        ELSE IF $rollout = 0 THEN 'Only ' + $c
        ELSE <string> $rollout + '%' + IF $n > 0 THEN ' + ' + $c ELSE '' END
        END;
};

-- Sort key that orders numbers inside names by value: "test-2" before "test-10".
-- Lowercased; every run of digits zero-padded to 20 places, so numbers up to 20 digits (a
-- millisecond timestamp has 13) sort by value. Longer runs aren't padded (no error).
DEFINE FUNCTION OVERWRITE fn::natural_key($s: string) -> string {
    LET $r = array::fold(string::split(string::lowercase($s), ''), { out: '', num: '' }, |$acc, $c|
        IF string::is_numeric($c) THEN { out: $acc.out, num: $acc.num + $c }
        ELSE { out: $acc.out + IF $acc.num = '' THEN '' ELSE string::repeat('0', math::max([0, 20 - string::len($acc.num)])) + $acc.num END + $c, num: '' } END);
    RETURN $r.out + IF $r.num = '' THEN '' ELSE string::repeat('0', math::max([0, 20 - string::len($r.num)])) + $r.num END;
};

-- ETag source (spec 04): bump the global counter and stamp it on one environment, or on all.
DEFINE FUNCTION OVERWRITE fn::bump_revision($env: option<record<environment>>) {
    UPDATE sdk_revision:main SET revision_id += 1;
    LET $r = sdk_revision:main.revision_id;
    IF $env = NONE { UPDATE environment SET revision_id = $r; } ELSE { UPDATE $env SET revision_id = $r; };
};

-- ================================================================ reference data

DEFINE TABLE OVERWRITE environment SCHEMAFULL;
DEFINE FIELD OVERWRITE key          ON environment TYPE string;
DEFINE FIELD OVERWRITE display_name ON environment TYPE string;
DEFINE FIELD OVERWRITE sort_order   ON environment TYPE int;
DEFINE FIELD OVERWRITE revision_id  ON environment TYPE int DEFAULT 0;

DEFINE TABLE OVERWRITE sdk_revision SCHEMAFULL;
DEFINE FIELD OVERWRITE revision_id ON sdk_revision TYPE int DEFAULT 0;

DEFINE TABLE OVERWRITE settings SCHEMAFULL;
-- Context field names are what apps send (an identifier); the two must differ.
DEFINE FIELD OVERWRITE brand_context_field    ON settings TYPE string DEFAULT 'brand'
    ASSERT string::matches($value, '^[A-Za-z_][A-Za-z0-9_]{0,63}$');
DEFINE FIELD OVERWRITE customer_context_field ON settings TYPE string DEFAULT 'userId'
    ASSERT string::matches($value, '^[A-Za-z_][A-Za-z0-9_]{0,63}$') AND $value != $this.brand_context_field;
-- One origin per line (or comma): `*` or http(s)://host[:port], at most 50.
DEFINE FIELD OVERWRITE frontend_cors_origins  ON settings TYPE string DEFAULT ''
    VALUE array::join(array::distinct(fn::list_items(fn::norm_list($value)).map(|$o|
        IF string::ends_with($o, '/') THEN string::slice($o, 0, string::len($o) - 1) ELSE $o END)), '\n')
    ASSERT array::len(fn::list_items(fn::norm_list($value))) <= 50
       AND array::len(array::filter(fn::list_items(fn::norm_list($value)),
           |$o| $o != '*' AND !string::matches($o, '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'))) = 0;
DEFINE FIELD OVERWRITE metrics_retention_days ON settings TYPE int DEFAULT 30 ASSERT $value >= 7 AND $value <= 3650;
DEFINE FIELD OVERWRITE unused_flag_days       ON settings TYPE int DEFAULT 30 ASSERT $value >= 1 AND $value <= 3650;
-- When usage recording started: "not seen in N days" is only reliable N days after this.
DEFINE FIELD OVERWRITE usage_recording_since  ON settings TYPE datetime DEFAULT time::now() ASSERT $before = NONE OR $before = $value;
DEFINE FIELD OVERWRITE admin_scope            ON settings TYPE string VALUE 'all';

-- The key is what apps send as the brand; it can't change (spec 02).
DEFINE TABLE OVERWRITE brand SCHEMAFULL;
DEFINE FIELD OVERWRITE key          ON brand TYPE string
    ASSERT string::matches($value, '^[a-z0-9][a-z0-9-]{0,62}$') AND ($before = NONE OR $before = $value);
DEFINE FIELD OVERWRITE display_name ON brand TYPE string ASSERT string::len(string::trim($value)) > 0;
DEFINE FIELD OVERWRITE active       ON brand TYPE bool DEFAULT true;
DEFINE FIELD OVERWRITE created_at   ON brand TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE created_by   ON brand TYPE string DEFAULT 'admin';
DEFINE INDEX OVERWRITE brand_key ON brand FIELDS key UNIQUE;
-- Constant the web API scopes admin screens on: admins get ['all'] (also on api_token, app_user, settings).
DEFINE FIELD OVERWRITE admin_scope  ON brand TYPE string VALUE 'all';

-- ================================================================ flags

-- Record id = flag:<name>. Names are unique including archived flags and never change.
DEFINE TABLE OVERWRITE flag SCHEMAFULL;
DEFINE FIELD OVERWRITE name        ON flag TYPE string
    ASSERT string::matches($value, '^[A-Za-z0-9._-]{1,100}$') AND ($before = NONE OR $before = $value);
DEFINE FIELD OVERWRITE description ON flag TYPE option<string> ASSERT $value = NONE OR string::len($value) <= 2000;
DEFINE FIELD OVERWRITE tags        ON flag TYPE string DEFAULT ''
    VALUE fn::norm_list(string::lowercase($value ?? '')) ASSERT fn::tags_ok($value);
DEFINE FIELD OVERWRITE stale       ON flag TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE archived    ON flag TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE archived_at ON flag TYPE option<datetime>;
DEFINE FIELD OVERWRITE archived_by ON flag TYPE option<string>;
DEFINE FIELD OVERWRITE created_at  ON flag TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE created_by  ON flag TYPE string DEFAULT 'admin';
-- Summary for the flags list, kept current by fn::refresh_flag (called from events), so the
-- list can filter on it and live views refresh when environments, overrides or usage change.
DEFINE FIELD OVERWRITE development      ON flag TYPE string DEFAULT '';
DEFINE FIELD OVERWRITE uat              ON flag TYPE string DEFAULT '';
DEFINE FIELD OVERWRITE production       ON flag TYPE string DEFAULT '';
DEFINE FIELD OVERWRITE override_count   ON flag TYPE int DEFAULT 0;
DEFINE FIELD OVERWRITE last_seen        ON flag TYPE option<datetime>;
DEFINE FIELD OVERWRITE last_seen_by_env ON flag TYPE string DEFAULT 'never';
DEFINE FIELD OVERWRITE touched_at       ON flag TYPE option<datetime>;
-- Who is making the current change (set by the web app with each write, cleared by the events
-- after they log it). Missing = the desktop app, logged as 'admin'.
DEFINE FIELD OVERWRITE updated_by       ON flag TYPE option<string>;
-- Constant the web API scopes metadata edits on: editors and admins get ['all'], viewers [].
DEFINE FIELD OVERWRITE edit_scope       ON flag TYPE string VALUE 'all';
DEFINE FIELD OVERWRITE name_sort        ON flag TYPE string VALUE fn::natural_key($this.name);
-- For the web list's filters (the API has no OR and no multi-column search, FEEDBACK.md):
-- name + description lower-cased, and the tags as ",a,b," so `like '%,a,%'` matches one tag.
DEFINE FIELD OVERWRITE search_text      ON flag TYPE string VALUE string::lowercase($this.name + ' ' + ($this.description ?? ''));
DEFINE FIELD OVERWRITE tags_key         ON flag TYPE string VALUE ',' + ($this.tags ?? '') + ',';
-- Last seen, or created when never seen (ISO text), for "not seen in N days"; kept by fn::refresh_flag.
DEFINE FIELD OVERWRITE last_activity    ON flag TYPE string DEFAULT '';
-- Each environment's brand overrides as "Greenfield Stores: 10%, Northwind Air: OFF" (list tooltips); fn::refresh_flag.
DEFINE FIELD OVERWRITE development_brands ON flag TYPE string DEFAULT '';
DEFINE FIELD OVERWRITE uat_brands         ON flag TYPE string DEFAULT '';
DEFINE FIELD OVERWRITE production_brands  ON flag TYPE string DEFAULT '';
DEFINE INDEX OVERWRITE flag_name ON flag FIELDS name UNIQUE;
DEFINE INDEX OVERWRITE flag_name_sort ON flag FIELDS name_sort;

-- One per flag x environment; id = flag_env:`<flag>@<environment>` (flag names never contain '@';
-- a ':' would be read as a table separator when the app looks a row up by its key).
DEFINE TABLE OVERWRITE flag_env SCHEMAFULL;
DEFINE FIELD OVERWRITE flag              ON flag_env TYPE record<flag> ASSERT $before = NONE OR $before = $value;
DEFINE FIELD OVERWRITE environment       ON flag_env TYPE record<environment> ASSERT $before = NONE OR $before = $value;
-- plain-text copies of the environment key and flag name, for screens that filter by equality
DEFINE FIELD OVERWRITE env_key           ON flag_env TYPE string VALUE <string> record::id($this.environment);
DEFINE FIELD OVERWRITE flag_name         ON flag_env TYPE string VALUE <string> record::id($this.flag);
DEFINE INDEX OVERWRITE flag_env_name_env ON flag_env FIELDS flag_name, env_key;
-- link to the service's last-seen record for this flag x environment (it may not exist yet)
DEFINE FIELD OVERWRITE last_seen         ON flag_env TYPE record<flag_last_seen>
    VALUE type::record('flag_last_seen', $this.flag_name + ':' + $this.env_key);
DEFINE FIELD OVERWRITE enabled           ON flag_env TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE default_rollout   ON flag_env TYPE int DEFAULT 100 ASSERT $value >= 0 AND $value <= 100;
DEFINE FIELD OVERWRITE default_allowlist ON flag_env TYPE string DEFAULT ''
    VALUE fn::norm_list($value) ASSERT fn::allowlist_ok($value);
DEFINE FIELD OVERWRITE revision          ON flag_env TYPE int DEFAULT 1;
DEFINE FIELD OVERWRITE touched_at        ON flag_env TYPE option<datetime>;
DEFINE FIELD OVERWRITE updated_by        ON flag_env TYPE option<string>;
-- A whole-card save from the web, in one write (the API has no transactions, FEEDBACK.md):
-- `expected_revision` = the revision the person started from (a conflict is refused), and
-- `pending_overrides` = JSON [{brand, rollout, allowlist}], the complete wanted set. The
-- flag_env event checks, applies and clears both inside the same transaction.
DEFINE FIELD OVERWRITE expected_revision ON flag_env TYPE option<int>;
DEFINE FIELD OVERWRITE pending_overrides ON flag_env TYPE option<string>;
DEFINE INDEX OVERWRITE flag_env_flag ON flag_env FIELDS flag;

-- A rule replacing the default for one brand. Rollout left empty on create = copy the default.
-- `scope` ("<flag>@<environment>") is what screens write and filter by; flag_env follows from it.
DEFINE TABLE OVERWRITE brand_override SCHEMAFULL;
DEFINE FIELD OVERWRITE scope     ON brand_override TYPE string
    ASSERT type::record('flag_env', $value).id != NONE AND ($before = NONE OR $before = $value);
DEFINE FIELD OVERWRITE flag_env  ON brand_override TYPE record<flag_env> VALUE type::record('flag_env', $this.scope);
DEFINE FIELD OVERWRITE env_key   ON brand_override TYPE string VALUE array::last(string::split($this.scope, '@'));
DEFINE FIELD OVERWRITE updated_by ON brand_override TYPE option<string>;
DEFINE FIELD OVERWRITE brand     ON brand_override TYPE record<brand> ASSERT $before = NONE OR $before = $value;
DEFINE FIELD OVERWRITE rollout   ON brand_override TYPE option<int> ASSERT $value = NONE OR ($value >= 0 AND $value <= 100);
DEFINE FIELD OVERWRITE allowlist ON brand_override TYPE string DEFAULT ''
    VALUE fn::norm_list($value) ASSERT fn::allowlist_ok($value);
DEFINE FIELD OVERWRITE ready     ON brand_override TYPE bool DEFAULT false;
DEFINE INDEX OVERWRITE brand_override_scope ON brand_override FIELDS scope;
DEFINE INDEX OVERWRITE brand_override_unique ON brand_override FIELDS flag_env, brand UNIQUE;

-- ================================================================ audit log (spec 07)

DEFINE TABLE OVERWRITE audit_event SCHEMAFULL;
DEFINE FIELD OVERWRITE type        ON audit_event TYPE string;
DEFINE FIELD OVERWRITE created_at  ON audit_event TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE created_by  ON audit_event TYPE string DEFAULT 'admin';
DEFINE FIELD OVERWRITE flag        ON audit_event TYPE option<string>;
DEFINE FIELD OVERWRITE environment ON audit_event TYPE option<string>;
DEFINE FIELD OVERWRITE brand       ON audit_event TYPE option<string>;
DEFINE FIELD OVERWRITE summary     ON audit_event TYPE string;
DEFINE FIELD OVERWRITE pre_data    ON audit_event TYPE option<string>;
DEFINE FIELD OVERWRITE data        ON audit_event TYPE option<string>;
DEFINE INDEX OVERWRITE audit_event_flag ON audit_event FIELDS flag;
DEFINE INDEX OVERWRITE audit_event_created ON audit_event FIELDS created_at;

-- ================================================================ API tokens (spec 04)
-- Only an argon2id hash is stored; the SDK service narrows by `lookup` (first 24 characters).

DEFINE TABLE OVERWRITE api_token SCHEMAFULL;
DEFINE FIELD OVERWRITE name         ON api_token TYPE string ASSERT string::len(string::trim($value)) > 0;
DEFINE FIELD OVERWRITE type         ON api_token TYPE string ASSERT $value IN ['backend', 'frontend'] AND ($before = NONE OR $before = $value);
-- the web app sends the environment's key as text
DEFINE FIELD OVERWRITE environment  ON api_token TYPE record<environment> | string
    VALUE IF type::is_string($value) THEN type::record('environment', $value) ELSE $value END
    ASSERT $before = NONE OR $before = $value;
DEFINE FIELD OVERWRITE source       ON api_token TYPE string DEFAULT 'created' ASSERT $value IN ['created', 'imported'];
-- The web app sends the secret itself once, in `new_secret`; the database stores only its
-- argon2id hash, lookup and hint, and the event below forgets the secret straight away.
DEFINE FIELD OVERWRITE new_secret   ON api_token TYPE option<string>;
DEFINE FIELD OVERWRITE secret_hash  ON api_token TYPE string
    VALUE IF $this.new_secret != NONE AND $before = NONE THEN crypto::argon2::generate($this.new_secret) ELSE $value END
    ASSERT string::starts_with($value, '$argon2') AND ($before = NONE OR $before = $value);
DEFINE FIELD OVERWRITE lookup       ON api_token TYPE string
    VALUE IF $this.new_secret != NONE AND $before = NONE THEN string::slice($this.new_secret, 0, 24) ELSE $value END
    ASSERT $before = NONE OR $before = $value;
DEFINE FIELD OVERWRITE hint         ON api_token TYPE string
    VALUE IF $this.new_secret != NONE AND $before = NONE THEN string::slice($this.new_secret, 0, 24) + '...' ELSE $value END;
DEFINE FIELD OVERWRITE admin_scope  ON api_token TYPE string VALUE 'all';
DEFINE FIELD OVERWRITE created_at   ON api_token TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE created_by   ON api_token TYPE string DEFAULT 'admin';
DEFINE FIELD OVERWRITE last_used_at ON api_token TYPE option<datetime>;
DEFINE INDEX OVERWRITE api_token_lookup ON api_token FIELDS lookup;

-- ================================================================ users (spec 07)

DEFINE TABLE OVERWRITE app_user SCHEMAFULL;
DEFINE FIELD OVERWRITE name                  ON app_user TYPE string ASSERT string::len(string::trim($value)) > 0;
DEFINE FIELD OVERWRITE email                 ON app_user TYPE string ASSERT string::is_email($value);
DEFINE FIELD OVERWRITE role                  ON app_user TYPE string DEFAULT 'viewer' ASSERT $value IN ['viewer', 'editor', 'admin'];
DEFINE FIELD OVERWRITE editable_environments ON app_user TYPE string DEFAULT ''
    VALUE fn::norm_list($value)
    ASSERT array::len(array::filter(fn::list_items($value), |$v| $v NOT IN ['development', 'uat', 'production'])) = 0;
DEFINE FIELD OVERWRITE active                ON app_user TYPE bool DEFAULT true;
-- The web app sends a new temporary password once, in `new_password`; only its hash is kept
-- and the person must change it at first login (spec 07). The event forgets it straight away.
DEFINE FIELD OVERWRITE new_password          ON app_user TYPE option<string>;
DEFINE FIELD OVERWRITE password_hash         ON app_user TYPE option<string>
    VALUE IF $this.new_password != NONE THEN crypto::argon2::generate($this.new_password) ELSE $value END;
DEFINE FIELD OVERWRITE must_change_password  ON app_user TYPE bool DEFAULT true
    VALUE IF $this.new_password != NONE THEN true ELSE $value END;
-- Stamped by the app_user event whenever password_hash changes (any writer).
DEFINE FIELD OVERWRITE password_changed_at   ON app_user TYPE option<datetime>;
DEFINE FIELD OVERWRITE admin_scope           ON app_user TYPE string VALUE 'all';
DEFINE FIELD OVERWRITE last_login_at         ON app_user TYPE option<datetime>;
DEFINE FIELD OVERWRITE updated_by            ON app_user TYPE option<string>;
DEFINE FIELD OVERWRITE created_at            ON app_user TYPE datetime DEFAULT time::now();
DEFINE INDEX OVERWRITE app_user_email ON app_user FIELDS email UNIQUE;

-- ================================================================ usage metrics (spec 08)
-- Written by the SDK service from SDK metric posts; read here.

DEFINE TABLE OVERWRITE metric_hourly SCHEMAFULL;
DEFINE FIELD OVERWRITE flag        ON metric_hourly TYPE string;
DEFINE FIELD OVERWRITE environment ON metric_hourly TYPE string;
DEFINE FIELD OVERWRITE app_name    ON metric_hourly TYPE string;
DEFINE FIELD OVERWRITE hour        ON metric_hourly TYPE datetime;
DEFINE FIELD OVERWRITE yes         ON metric_hourly TYPE int DEFAULT 0;
DEFINE FIELD OVERWRITE no          ON metric_hourly TYPE int DEFAULT 0;
DEFINE INDEX OVERWRITE metric_hourly_key ON metric_hourly FIELDS flag, environment, hour;

DEFINE TABLE OVERWRITE flag_last_seen SCHEMAFULL;
DEFINE FIELD OVERWRITE flag         ON flag_last_seen TYPE string;
DEFINE FIELD OVERWRITE environment  ON flag_last_seen TYPE string;
DEFINE FIELD OVERWRITE last_seen_at ON flag_last_seen TYPE datetime;
DEFINE INDEX OVERWRITE flag_last_seen_flag ON flag_last_seen FIELDS flag;

DEFINE TABLE OVERWRITE unknown_flag SCHEMAFULL;
DEFINE FIELD OVERWRITE name         ON unknown_flag TYPE string;
DEFINE FIELD OVERWRITE environment  ON unknown_flag TYPE string;
DEFINE FIELD OVERWRITE app_name     ON unknown_flag TYPE string;
DEFINE FIELD OVERWRITE last_seen_at ON unknown_flag TYPE datetime;
DEFINE FIELD OVERWRITE count        ON unknown_flag TYPE int DEFAULT 0;

DEFINE TABLE OVERWRITE client_app SCHEMAFULL;
DEFINE FIELD OVERWRITE app_name     ON client_app TYPE string;
DEFINE FIELD OVERWRITE environment  ON client_app TYPE string;
DEFINE FIELD OVERWRITE instance_id  ON client_app TYPE string;
DEFINE FIELD OVERWRITE sdk_version  ON client_app TYPE option<string>;
DEFINE FIELD OVERWRITE last_seen_at ON client_app TYPE datetime;

-- ================================================================ screens: summaries

-- A flag's cell in the flags list for one environment: "Disabled", or the default rule label
-- plus "  +2 brands" when overrides exist.
DEFINE FUNCTION OVERWRITE fn::env_cell($flag: string, $env: string) -> string {
    LET $fe = type::record('flag_env', $flag + '@' + $env);
    LET $n = count(SELECT id FROM brand_override WHERE scope = $flag + '@' + $env);
    RETURN IF !$fe.enabled THEN 'Disabled'
        ELSE fn::rule_label($fe.default_rollout, $fe.default_allowlist)
             + IF $n = 0 THEN '' ELSE IF $n = 1 THEN '  +1 brand' ELSE '  +' + <string> $n + ' brands' END
        END;
};

-- One environment's brand overrides for a tooltip: "Greenfield Stores: 10% + 2 customers, Northwind Air: OFF".
DEFINE FUNCTION OVERWRITE fn::brand_rules($flag: string, $env: string) -> string {
    LET $o = SELECT brand.display_name AS b, rollout, allowlist FROM brand_override WHERE scope = $flag + '@' + $env;
    RETURN array::join(array::sort($o.map(|$x| $x.b + ': ' + fn::rule_label($x.rollout, $x.allowlist))), ', ');
};

DEFINE FUNCTION OVERWRITE fn::refresh_flag($f: record<flag>) {
    LET $name = $f.name;
    LET $seen = SELECT environment, last_seen_at FROM flag_last_seen WHERE flag = $name ORDER BY environment;
    LET $last = IF array::len($seen) = 0 THEN NONE ELSE array::max($seen.last_seen_at) END;
    UPDATE $f SET
        development = fn::env_cell($name, 'development'),
        uat = fn::env_cell($name, 'uat'),
        production = fn::env_cell($name, 'production'),
        development_brands = fn::brand_rules($name, 'development'),
        uat_brands = fn::brand_rules($name, 'uat'),
        production_brands = fn::brand_rules($name, 'production'),
        override_count = count(SELECT id FROM brand_override WHERE string::starts_with(scope, $name + '@')),
        last_seen = $last,
        last_activity = <string> ($last ?? $f.created_at),
        last_seen_by_env = IF array::len($seen) = 0 THEN 'never'
            ELSE array::join($seen.map(|$s| $s.environment + ' ' + time::format($s.last_seen_at, '%Y-%m-%d %H:%M')), ', ') END,
        touched_at = time::now();
};

-- Tags in use on live flags, with how many flags carry each (tag filter, tag suggestions).
-- Kept by the flag event; fn::rebuild_tags recounts from scratch after loading data.
DEFINE TABLE OVERWRITE known_tag SCHEMAFULL;
DEFINE FIELD OVERWRITE name  ON known_tag TYPE string;
DEFINE FIELD OVERWRITE flags ON known_tag TYPE int DEFAULT 0;

DEFINE FUNCTION OVERWRITE fn::count_tags($tags: array<string>, $delta: int) {
    FOR $t IN $tags {
        UPSERT type::record('known_tag', $t) SET name = $t, flags = (flags ?? 0) + $delta;
    };
    DELETE known_tag WHERE flags <= 0;
};

DEFINE FUNCTION OVERWRITE fn::rebuild_tags() {
    DELETE known_tag;
    fn::count_tags(array::flatten(SELECT VALUE fn::list_items(tags) FROM flag WHERE archived != true), 1);
};

-- Compilation (what SDKs receive, spec 03) lives in the flag service: service/src/compile.rs.
