import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { observer, useCollection, useWindow } from "@vantage-ui/client/react";
import { useDb } from "../auth";
import { ENVIRONMENTS, download, fileStamp, lineDiff, prettyJson, relTime, toCsv } from "../format";
import { useAddressText, useDebounced } from "../hooks";
import type { History } from "../vantage.gen";

const PAGE = 50;

/** Every event type the database writes (tests/events.surql). */
const EVENT_TYPES = [
  "feature-created", "feature-tagged", "feature-untagged", "feature-metadata-updated", "feature-stale-on", "feature-stale-off",
  "feature-archived", "feature-revived", "feature-deleted",
  "feature-environment-enabled", "feature-environment-disabled", "feature-default-rule-updated",
  "feature-brand-override-added", "feature-brand-override-updated", "feature-brand-override-removed",
  "brand-created", "brand-updated", "brand-deleted", "settings-updated",
  "api-token-created", "api-token-imported", "api-token-deleted",
  "user-created", "user-updated", "user-deactivated", "user-password-reset",
];

const FILTERS = ["q", "user", "flag", "env", "brand", "type", "from", "to"] as const;
type Filters = Record<(typeof FILTERS)[number], string>;

/** Audit log (spec 05 screen 5): newest first, filters (kept in the address), 50 per page, before/after diff. */
export const AuditLogPage = observer(() => {
  const db = useDb();
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ""])) as Filters;
  // From the address as it is now: a delayed update (a typed filter) must not undo a newer one.
  const set = (k: keyof Filters, v: string) => {
    const n = new URLSearchParams(window.location.search);
    if (v) n.set(k, v); else n.delete(k);
    n.delete("page");
    setParams(n, { replace: true });
  };
  const page = Number(params.get("page") ?? 0);
  const setPage = (n: number) => {
    const x = new URLSearchParams(window.location.search);
    if (n) x.set("page", String(n)); else x.delete("page");
    setParams(x);
  };
  const brands = useCollection(db.brands.sort("display_name", "asc")).items;
  // typed filters keep their own text; the address (and the query) follow once typing pauses
  const [qText, setQText] = useAddressText(f.q, (v) => set("q", v), 300);
  const [userText, setUserText] = useAddressText(f.user, (v) => set("user", v), 300);
  const q = f.q.trim();
  const user = f.user.trim();

  // The server filters, sorts and pages (vantage-web: never on the page).
  const where: Record<string, unknown> = {};
  if (q) where.summary = { like: q };
  if (user) where.created_by = { like: user };
  if (f.flag) where.flag = f.flag;
  if (f.env) where.environment = f.env;
  if (f.brand) where.brand = f.brand;
  if (f.type) where.type = f.type;
  let events = db.history.where(where).sort("created_at", "desc");
  // dates are whole local days
  if (f.from) events = events.where({ created_at: { gte: new Date(`${f.from}T00:00:00`).toISOString() } });
  if (f.to) events = events.where({ created_at: { lte: new Date(`${f.to}T23:59:59.999`).toISOString() } });
  const win = useWindow(events, page * PAGE, PAGE);
  const pages = Math.max(1, Math.ceil(win.length / PAGE));
  const [exporting, setExporting] = useState(false);
  const any = FILTERS.some((k) => f[k]);

  /** Export the current filter (spec 05 screen 5): every matching event, not just this page. */
  async function exportAs(format: "csv" | "json") {
    setExporting(true);
    const all = await events.limit(10000).load();
    setExporting(false);
    const columns = ["created_at", "created_by", "type", "flag", "environment", "brand", "summary", "pre_data", "data"];
    const rows = all.map((h) => Object.fromEntries(columns.map((c) => [c, (h as unknown as Record<string, unknown>)[c] ?? null])));
    if (format === "csv") download(`audit-log-${fileStamp()}.csv`, toCsv(rows, columns), "text/csv");
    else download(`audit-log-${fileStamp()}.json`, JSON.stringify(rows, null, 2), "application/json");
  }

  return (
    <section>
      <div className="toolbar">
        <h2>Audit log</h2>
        <input className="search" placeholder="Search changes…" value={qText} onChange={(e) => setQText(e.target.value)} />
        <span className="spacer" />
        <button disabled={exporting} onClick={() => void exportAs("csv")}>Export CSV</button>
        <button disabled={exporting} onClick={() => void exportAs("json")}>Export JSON</button>
      </div>
      <div className="filters">
        <FlagPicker value={f.flag} onChange={(v) => set("flag", v)} />
        <input placeholder="User email contains…" value={userText} onChange={(e) => setUserText(e.target.value)} aria-label="User" />
        <select value={f.env} onChange={(e) => set("env", e.target.value)} aria-label="Environment">
          <option value="">All environments</option>
          {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={f.brand} onChange={(e) => set("brand", e.target.value)} aria-label="Brand">
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.key ?? ""}>{b.display_name}</option>)}
        </select>
        <select value={f.type} onChange={(e) => set("type", e.target.value)} aria-label="Event type">
          <option value="">All events</option>
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="small">From <input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} /></label>
        <label className="small">To <input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} /></label>
        {any && <button className="link" onClick={() => setParams({}, { replace: true })}>Clear filters</button>}
      </div>
      {win.error && <p role="alert" className="error">{win.error}</p>}
      <table className="grid compact">
        <thead>
          <tr><th>Time</th><th>User</th><th>Event</th><th>Flag</th><th>Environment</th><th>Brand</th><th>Change</th></tr>
        </thead>
        <tbody>{win.items.map((h, i) => (h ? <EventRow key={h.id} h={h} brandName={brands.find((b) => b.key === h.brand)?.display_name ?? h.brand} /> : <tr key={`p${i}`}><td colSpan={7} className="muted">…</td></tr>))}</tbody>
      </table>
      {win.settled && win.items.length === 0 && <p className="muted">No events match.</p>}
      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Newer</button>
        <span className="muted">Page {page + 1}{win.lengthExact ? ` of ${pages} · ${win.length} events` : ""}</span>
        <button disabled={win.settled && (page + 1) * PAGE >= win.length} onClick={() => setPage(page + 1)}>Older ›</button>
      </div>
    </section>
  );
});

/** Flag filter with suggestions as you type - live, archived and deleted flags alike. */
const FlagPicker = observer(({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const db = useDb();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const typed = useDebounced(text.trim(), 200);
  const names = useCollection(db.flag_names.where(typed ? { name: { like: typed } } : {}).sort("name", "asc").limit(20)).items;
  const commit = (v: string) => onChange(v.trim());
  return (
    <span className="picker">
      <input
        list="audit-flag-names" placeholder="Flag…" value={text} aria-label="Flag"
        onChange={(e) => { setText(e.target.value); if (names.some((n) => n.name === e.target.value)) commit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Enter") commit(text); if (e.key === "Escape") { setText(""); commit(""); } }}
        onBlur={() => commit(text)}
      />
      <datalist id="audit-flag-names">{names.map((n) => <option key={n.id} value={n.name ?? ""}>{n.events} events</option>)}</datalist>
      {text && <button className="link" aria-label="Clear flag" onClick={() => { setText(""); commit(""); }}>×</button>}
    </span>
  );
});

const EventRow = observer(({ h, brandName }: { h: History; brandName: string | null }) => {
  const [open, setOpen] = useState(false);
  const diff = open ? lineDiff(prettyJson(h.pre_data), prettyJson(h.data)) : [];
  return (
    <>
      <tr className="clickable" onClick={() => setOpen(!open)} aria-expanded={open}>
        <td className="muted nowrap" title={h.created_at ?? ""}>{relTime(h.created_at)}</td>
        <td className="nowrap">{h.created_by}</td>
        <td className="muted small nowrap">{h.type}</td>
        <td className="nowrap">{h.flag && <Link to={`/flags/${encodeURIComponent(h.flag)}`} onClick={(e) => e.stopPropagation()}>{h.flag}</Link>}</td>
        <td>{h.environment}</td>
        <td>{brandName}</td>
        <td>{h.summary}</td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={7}>
            <p className="muted small">{h.created_at} · {h.type}</p>
            {diff.length === 0 ? (
              <p className="muted">No before/after data for this event.</p>
            ) : (
              <pre className="jsondiff">
                {diff.map((l, i) => <div key={i} className={l.kind === "+" ? "add" : l.kind === "-" ? "del" : ""}>{l.kind} {l.text}</div>)}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
});
