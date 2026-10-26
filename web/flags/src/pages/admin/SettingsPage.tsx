import { useMemo, useState, type FormEvent } from "react";
import { observer, useRecord } from "@vantage-ui/client/react";
import { useDb } from "../../auth";
import { friendlyError } from "../../format";

/** Settings (spec 05 screen 10, admins). Changing a context field name asks for confirmation. */
export const SettingsPage = observer(() => {
  const db = useDb();
  const ref = useMemo(() => db.settings_admin.ref("settings:main"), [db]);
  const { value: s, error: loadError } = useRecord(ref);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!s) return <p className="muted">{loadError ?? "Loading…"}</p>;

  const val = (k: "brand_context_field" | "customer_context_field" | "frontend_cors_origins" | "unused_flag_days" | "metrics_retention_days") =>
    draft[k] ?? String(s[k] ?? "");
  const set = (k: string) => (e: { target: { value: string } }) => { setSaved(false); setDraft({ ...draft, [k]: e.target.value }); };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    const contextChanged = "brand_context_field" in draft || "customer_context_field" in draft;
    if (contextChanged && !confirm("Changing a context field name changes what every SDK receives. Continue?")) return;
    setError(null);
    // Only the fields this admin edited: a concurrent change by another admin to the others stays.
    const fields: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(draft)) fields[k] = k.endsWith("_days") ? Number(v) : v.trim();
    const r = await s.patch(fields);
    if (!r.ok) return setError(friendlyError(r.error.message));
    setDraft({});
    setSaved(true);
  }

  const origins = val("frontend_cors_origins").split(/[\s,]+/).filter(Boolean);
  return (
    <section>
      <div className="toolbar"><h2>Settings</h2></div>
      <form className="card settings" onSubmit={save}>
        <p className="lock">⚠ Changing either context field name changes what every SDK receives. An app that still sends the old name no longer matches any brand and gets the default rule. Confirm with the app teams first.</p>
        <label>Brand field name<input value={val("brand_context_field")} onChange={set("brand_context_field")} required pattern="[A-Za-z_][A-Za-z0-9_]{0,63}" /></label>
        <label>Customer field name (also the rollout stickiness)<input value={val("customer_context_field")} onChange={set("customer_context_field")} required pattern="[A-Za-z_][A-Za-z0-9_]{0,63}" /></label>
        <label>
          Allowed web origins (one per line, like https://app.example.com)
          <textarea rows={3} value={val("frontend_cors_origins")} onChange={set("frontend_cors_origins")} />
        </label>
        {(origins.length === 0 || origins.includes("*")) && <p className="note">With no origins (or *), every website may ask for flags from the browser.</p>}
        <div className="row">
          <label>Flag counts as unused after (days)<input type="number" min={1} max={3650} value={val("unused_flag_days")} onChange={set("unused_flag_days")} /></label>
          <label>Keep usage data for (days)<input type="number" min={7} max={3650} value={val("metrics_retention_days")} onChange={set("metrics_retention_days")} /></label>
        </div>
        <p className="muted small">Usage recorded since {s.usage_recording_since?.slice(0, 10) ?? "—"}. "Last seen" times are kept regardless.</p>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="actions">
          {saved && <span className="rule-on">Saved ✓</span>}
          <button type="button" disabled={Object.keys(draft).length === 0} onClick={() => setDraft({})}>Discard</button>
          <button type="submit" className="primary" disabled={Object.keys(draft).length === 0}>Save</button>
        </div>
      </form>
    </section>
  );
});
