import { useEffect, useMemo, useState } from "react";
import { observer, useCollection, useRecord } from "@vantage-ui/client/react";
import { useConfig, useDb, usePermissions } from "../auth";
import { ENVIRONMENTS, friendlyError, listItems, relTime, ruleClass, type Env } from "../format";
import { explain, isEnabled, type Feature } from "../preview";
import { isConflict, modeOf, problems, rolloutFor, saveFields, sameRules, type Draft, type Mode, type Rule } from "./card-draft";

type Props = {
  flag: string;
  env: Env;
  /** Archived flags are shown read-only. */
  archived: boolean;
  /** The staged edits, kept by the page so they survive switching tabs (null = none). */
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  onDirty: (dirty: boolean) => void;
};

/** One environment of a flag: switch, default rule, brand overrides, preview (spec 05 screen 3). */
export const EnvironmentCard = observer(({ flag, env, archived, draft, setDraft, onDirty }: Props) => {
  const db = useDb();
  const { canEditEnv, email } = usePermissions();
  const editable = canEditEnv(env) && !archived;
  const fe = useCollection(db.environments.where({ flag_name: flag, env_key: env })).items[0];
  const ovs = useCollection(db.overrides.where({ scope: `${flag}@${env}` }).sort("brand_name", "asc")).items;
  const brands = useCollection(db.brands.sort("display_name", "asc")).items;
  const ref = useMemo(() => db.environment_edits.ref(`flag_env:${flag}@${env}`), [db, flag, env]);
  const edit = useRecord(ref);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // after our own switch flip, the draft follows the new revision (it isn't someone else's change)
  const [rebaseFrom, setRebaseFrom] = useState<number | null>(null);

  const server = {
    def: { rollout: fe?.default_rollout ?? 100, allowlist: fe?.default_allowlist ?? "" },
    overrides: ovs.map((o) => ({ brand: o.brand_key ?? "", rollout: o.rollout ?? 0, allowlist: o.allowlist ?? "" })),
  };
  const view: Draft = draft ?? { baseRev: fe?.revision ?? 0, ...server };
  const dirty = draft !== null && !sameRules(draft, server);
  useEffect(() => { onDirty(dirty); }, [dirty]);
  useEffect(() => {
    if (draft && rebaseFrom !== null && fe && (fe.revision ?? 0) > rebaseFrom) {
      setDraft({ ...draft, baseRev: fe.revision ?? 0 });
      setRebaseFrom(null);
    }
  }, [fe?.revision]);

  if (!fe) return <div className="card">Loading…</div>;

  const names = new Map(brands.map((b) => [b.key ?? "", b.display_name ?? ""]));
  for (const o of ovs) names.set(o.brand_key ?? "", o.brand_name ?? "");
  const activeKeys = new Set(brands.filter((b) => b.active).map((b) => b.key ?? ""));
  const savedKeys = new Set(server.overrides.map((o) => o.brand));
  const issues = dirty ? problems(view, names, activeKeys, savedKeys) : [];
  const change = (fn: (d: Draft) => Draft) => { setError(null); setDraft(fn(view)); };
  const discard = () => { setDraft(null); setConflict(null); setError(null); };

  async function toggle() {
    if (!edit.value || !fe) return;
    const next = !fe.enabled;
    if (env === "production" && !confirm(`Turn ${flag} ${next ? "ON" : "OFF"} in production?\nApps get the change within a few seconds.`)) return;
    setError(null);
    const r = await edit.value.patch({ enabled: next, expected_revision: fe.revision ?? 0, updated_by: email });
    if (!r.ok) return isConflict(r.error.message) ? setConflict(friendlyError(r.error.message)) : setError(friendlyError(r.error.message));
    if (draft) setRebaseFrom(fe.revision ?? 0);
  }

  async function save() {
    if (!edit.value || !draft || issues.length) return;
    setBusy(true);
    setError(null);
    const r = await edit.value.patch(saveFields(draft, email));
    setBusy(false);
    if (!r.ok) return isConflict(r.error.message) ? setConflict(friendlyError(r.error.message)) : setError(friendlyError(r.error.message));
    setDraft(null);
    setConflict(null);
  }

  /** "Copy rules from": the other environment's saved rules become this card's draft (not saved yet). */
  async function copyFrom(other: Env) {
    const [src] = await db.environments.where({ flag_name: flag, env_key: other }).load();
    const srcOvs = await db.overrides.where({ scope: `${flag}@${other}` }).load();
    if (!src) return;
    change((d) => ({
      baseRev: d.baseRev,
      def: { rollout: src.default_rollout ?? 100, allowlist: src.default_allowlist ?? "" },
      overrides: srcOvs.map((o) => ({ brand: o.brand_key ?? "", rollout: o.rollout ?? 0, allowlist: o.allowlist ?? "" })),
    }));
  }

  const addable = brands.filter((b) => b.active && !view.overrides.some((o) => o.brand === b.key));

  return (
    <div className="card envcard">
      <div className="envhead">
        <div>
          <b className="upper">{env}</b> · <span className={fe.enabled ? "rule-on" : "rule-disabled"}>switch {fe.enabled ? "ON" : "OFF"}</span>
          <div className="muted small">
            Default (all other brands): {fe.default_label}
            {ovs.length > 0 && `  ·  ${ovs.length} brand override${ovs.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <span className="muted small">{fe.seen_at ? `last seen ${relTime(fe.seen_at)}` : "never seen"}</span>
      </div>
      {!editable && (
        <p className="lock" title={archived ? "Revive the flag to change it" : `Your role doesn't include ${env}`}>
          🔒 Read-only: {archived ? "this flag is archived." : `you can't change ${env}.`}
        </p>
      )}

      {editable && (
        <div className="row">
          <span className="label">Switch</span>
          <button type="button" className={fe.enabled ? "switch on" : "switch"} onClick={() => void toggle()} disabled={!edit.value} aria-pressed={!!fe.enabled}>
            <span className="knob" /> {fe.enabled ? "ON" : "OFF"}
          </button>
          <span className="muted small">{fe.enabled ? "Served by the rules below." : "Off for everyone in this environment."}</span>
          <span className="spacer" />
          <label className="small">
            Copy rules from{" "}
            <select value="" onChange={(e) => e.target.value && void copyFrom(e.target.value as Env)} aria-label="Copy rules from">
              <option value="">…</option>
              {ENVIRONMENTS.filter((e) => e !== env).map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
        </div>
      )}

      {conflict && (
        <div className="conflict" role="alert">
          <b>{conflict.replace(/ - your edits were not saved$/, "")}.</b> Your edits are still below and were not saved.
          <div className="actions left">
            <button onClick={discard}>Discard mine</button>
            <button className="primary" onClick={() => { setDraft({ ...view, baseRev: fe.revision ?? 0 }); setConflict(null); }}>
              Keep my edits
            </button>
          </div>
          <p className="muted small">"Keep my edits" saves over their change at the next Save.</p>
        </div>
      )}

      <div className="row top">
        <span className="label">Default rule <span className="muted small">(all other brands)</span></span>
        {editable ? (
          <RuleControl rule={view.def} onChange={(def) => change((d) => ({ ...d, def }))} />
        ) : (
          <span><b className={ruleClass(fe.default_label)}>{fe.default_label}</b>{view.def.allowlist && view.def.rollout < 100 ? ` — customers ${view.def.allowlist}` : ""}</span>
        )}
      </div>

      <div className="overrides">
        <h4>Brand overrides</h4>
        {view.overrides.length === 0 && <p className="muted small">None — every brand follows the default rule.</p>}
        {[...view.overrides].sort((a, b) => (names.get(a.brand) ?? a.brand).localeCompare(names.get(b.brand) ?? b.brand)).map((o) => {
          const inactive = !activeKeys.has(o.brand);
          return (
            <div className="ovrow" key={o.brand}>
              <span className="brandname">{names.get(o.brand) ?? o.brand}{inactive && <span className="badge">inactive</span>}</span>
              {editable ? (
                <>
                  <RuleControl rule={o} compact onChange={(r) => change((d) => ({ ...d, overrides: d.overrides.map((x) => (x.brand === o.brand ? { ...x, ...r } : x)) }))} />
                  <button className="link danger" onClick={() => change((d) => ({ ...d, overrides: d.overrides.filter((x) => x.brand !== o.brand) }))}>remove</button>
                </>
              ) : (
                <>
                  <b className={ruleClass(ovs.find((x) => x.brand_key === o.brand)?.rule_label)}>{ovs.find((x) => x.brand_key === o.brand)?.rule_label}</b>
                  {o.allowlist && o.rollout < 100 && <span className="muted small">customers {o.allowlist}</span>}
                </>
              )}
            </div>
          );
        })}
        {editable && addable.length > 0 && (
          <div className="row">
            <select
              value=""
              aria-label="Add brand override"
              onChange={(e) => e.target.value && change((d) => ({ ...d, overrides: [...d.overrides, { brand: e.target.value, ...d.def }] }))}
            >
              <option value="">+ Add brand override…</option>
              {addable.map((b) => <option key={b.id} value={b.key ?? ""}>{b.display_name} ({b.key})</option>)}
            </select>
            <span className="muted small">Starts as a copy of the default rule.</span>
          </div>
        )}
      </div>

      {editable && (dirty || error) && (
        <div className="savebar">
          {dirty && <span className="unsaved">Unsaved changes</span>}
          {issues.length > 0 && (
            <div className="problems" role="alert">
              Can't save yet:
              <ul>{issues.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          <span className="spacer" />
          <button disabled={!dirty || busy} onClick={discard}>Discard</button>
          <button className="primary" disabled={!dirty || busy || issues.length > 0 || !!conflict} onClick={() => void save()}>Save changes</button>
        </div>
      )}
      {(error || edit.error) && <p role="alert" className="error">{error ?? edit.error}</p>}

      <Preview flag={flag} env={env} enabled={!!fe.enabled} saved={server} names={names} brands={brands.map((b) => b.key ?? "")} dirty={dirty} />
    </div>
  );
});

/** OFF / ON / % with a percentage, and the customers always ON (hidden when ON - kept though). */
function RuleControl({ rule, onChange, compact = false }: { rule: Rule; onChange: (r: Rule) => void; compact?: boolean }) {
  const mode = modeOf(rule.rollout);
  const count = listItems(rule.allowlist).length;
  return (
    <span className={compact ? "rulectl compact" : "rulectl"}>
      <span className="segmented">
        {(["OFF", "ON", "%"] as Mode[]).map((m) => (
          <button type="button" key={m} className={mode === m ? "seg active" : "seg"} onClick={() => onChange({ ...rule, rollout: rolloutFor(m, rule.rollout) })}>{m}</button>
        ))}
      </span>
      {mode === "%" && (
        <>
          {!compact && <input type="range" min={1} max={99} value={rule.rollout} onChange={(e) => onChange({ ...rule, rollout: Number(e.target.value) })} />}
          <input
            type="number" min={1} max={99} className="pct" value={rule.rollout} aria-label="Percentage"
            onChange={(e) => onChange({ ...rule, rollout: Math.min(99, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
          />%
        </>
      )}
      {mode !== "ON" && (
        compact ? (
          <input className="allow" value={rule.allowlist} onChange={(e) => onChange({ ...rule, allowlist: e.target.value })} placeholder="Customers always ON" title={`${count} customers`} />
        ) : (
          <label className="allowbox">
            <span className="muted small">Customers always ON ({count})</span>
            <textarea rows={2} value={rule.allowlist} onChange={(e) => onChange({ ...rule, allowlist: e.target.value })} placeholder="Customer IDs, separated by commas, spaces or new lines" />
          </label>
        )
      )}
    </span>
  );
}

/** "Who gets this flag?" with the saved rules: the answer SDKs would give, and why. */
const Preview = observer((props: {
  flag: string; env: Env; enabled: boolean; dirty: boolean;
  saved: { def: Rule; overrides: { brand: string; rollout: number; allowlist: string }[] };
  names: Map<string, string>; brands: string[];
}) => {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [customer, setCustomer] = useState("");
  const [result, setResult] = useState<{ on: boolean; why: string; sdk: boolean } | null>(null);
  const config = useConfig();

  async function check() {
    const [row] = await db.compiled.where({ flag_name: props.flag, env_key: props.env }).load();
    if (!row?.served) return;
    const feature = JSON.parse(row.served) as Feature;
    const brandField = config?.brand_context_field ?? "brand";
    const customerField = config?.customer_context_field ?? "userId";
    const id = customer.trim();
    const properties: Record<string, string> = {};
    if (brand) properties[brandField] = brand;
    if (id && customerField !== "userId") properties[customerField] = id;
    const sdk = isEnabled(feature, { userId: customerField === "userId" && id ? id : undefined, properties });
    const ov = props.saved.overrides.find((o) => o.brand === brand);
    const scope = ov ? `the ${props.names.get(brand) ?? brand} override` : "the default rule";
    const rule = ov ?? props.saved.def;
    const why = explain({ enabled: props.enabled, env: props.env, scope, rule: { rollout: rule.rollout, allowlist: listItems(rule.allowlist) }, customer: id, groupId: props.flag });
    setResult({ ...why, sdk });
  }

  return (
    <details className="preview" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Preview: who gets this flag?</summary>
      <div className="row">
        <select value={brand} onChange={(e) => { setBrand(e.target.value); setResult(null); }} aria-label="Preview brand">
          <option value="">(no brand)</option>
          {props.brands.map((b) => <option key={b} value={b}>{props.names.get(b) ?? b}</option>)}
        </select>
        <input value={customer} onChange={(e) => { setCustomer(e.target.value); setResult(null); }} placeholder="Customer ID (optional)" aria-label="Customer ID" />
        <button onClick={() => void check()}>Check</button>
      </div>
      {props.dirty && <p className="muted small">The preview uses the saved rules, not your unsaved changes.</p>}
      {result && (
        <p className={result.sdk ? "verdict on" : "verdict off"} role="status">
          <b>{result.sdk ? "ON" : "OFF"}</b> — {result.why}
          {result.on !== result.sdk && <span className="error"> (The rules and what apps receive disagree - check the History.)</span>}
        </p>
      )}
    </details>
  );
});
