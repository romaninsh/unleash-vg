import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { observer, useCollection, useWindow } from "@vantage-ui/client/react";
import { useConfig, useDb, usePermissions } from "../auth";
import { ENVIRONMENTS, download, fileStamp, relTime, ruleClass, toCsv } from "../format";
import { useServerWindow } from "../list/useServerWindow";
import { useAddressText } from "../hooks";
import { NewFlagDialog } from "./NewFlagDialog";

/** Every row is this tall (name over a one-line description), so the list can scroll virtually. */
const ROW_HEIGHT = 46;
type SortColumn = "name_sort" | "last_seen_text" | "created_text";
type Sort = { column: SortColumn; dir: "asc" | "desc" };
type Quick = "all" | "stale" | "overrides" | "unused";
const DAY = 86_400_000;

/** A column header that sorts the list; a second click reverses it (spec 05: name, created, last seen). */
function SortHeader({ label, column, sort, onSort }: { label: string; column: SortColumn; sort: Sort; onSort: (s: Sort) => void }) {
  const active = sort.column === column;
  const next: Sort = { column, dir: active && sort.dir === "asc" ? "desc" : active ? "asc" : column === "name_sort" ? "asc" : "desc" };
  return (
    <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button className={active ? "sorthead active" : "sorthead"} onClick={() => onSort(next)}>
        {label} <span aria-hidden>{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

/** The list's state lives in the address (?q=, ?tag=, ?quick=, ?sort=), so a filtered list can be shared. */
function useListParams() {
  const [params, setParams] = useSearchParams();
  const sortText = params.get("sort") ?? "name_sort";
  const sort: Sort = { column: sortText.replace(/^-/, "") as SortColumn, dir: sortText.startsWith("-") ? "desc" : "asc" };
  // From the address as it is now: a delayed update (the search box) must not undo a newer one.
  const update = (change: (p: URLSearchParams) => void) => {
    const n = new URLSearchParams(window.location.search);
    change(n);
    setParams(n, { replace: true });
  };
  return {
    q: params.get("q") ?? "",
    tags: params.getAll("tag"),
    quick: (params.get("quick") ?? "all") as Quick,
    sort,
    setQ: (q: string) => update((p) => (q ? p.set("q", q) : p.delete("q"))),
    setTags: (tags: string[]) => update((p) => { p.delete("tag"); tags.forEach((t) => p.append("tag", t)); }),
    setQuick: (quick: Quick) => update((p) => (quick === "all" ? p.delete("quick") : p.set("quick", quick))),
    setSort: (s: Sort) => update((p) => {
      const v = `${s.dir === "desc" ? "-" : ""}${s.column}`;
      if (v === "name_sort") p.delete("sort"); else p.set("sort", v);
    }),
  };
}

/**
 * Flags list (spec 05 screen 2). The server filters and sorts; scrolling moves a window of rows
 * over the server's list, so only what is on screen is loaded and drawn.
 */
export const FlagList = observer(() => {
  const db = useDb();
  const navigate = useNavigate();
  const { canEditFlags } = usePermissions();
  const { q, tags, quick, sort, setQ, setTags, setQuick, setSort } = useListParams();
  const [searchText, setSearchText] = useAddressText(q, setQ);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const config = useConfig();
  const unusedDays = config?.unused_flag_days ?? 30;

  // "/" jumps to the search box, unless the person is typing somewhere already.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Search covers name and description; several tags narrow (the API has no OR, FEEDBACK.md).
  let flags = db.flags.sort(sort.column, sort.dir);
  if (q.trim()) flags = flags.where({ search_text: { like: q.trim().toLowerCase() } });
  for (const t of tags) flags = flags.where({ tags_key: { like: `,${t},` } });
  if (quick === "stale") flags = flags.where({ stale: true });
  if (quick === "overrides") flags = flags.where({ override_count: { gt: 0 } });
  // never seen counts from when it was created (last_activity = last seen, else created)
  if (quick === "unused") flags = flags.where({ last_activity: { lt: new Date(Date.now() - unusedDays * DAY).toISOString() } });
  const filtered = !!q.trim() || tags.length > 0 || quick !== "all";
  const { scrollRef, scrollToTop, visible, rowAt, total, exact, loading, error, padTop, padBottom } = useServerWindow(flags, ROW_HEIGHT);
  const everything = useWindow(db.flags.sort("name_sort", "asc"), 0, 1);
  useEffect(() => { scrollToTop(); }, [q, tags.join(","), quick, sort.column, sort.dir]);

  async function exportCsv() {
    setExporting(true);
    const rows = await flags.limit(10000).load();
    setExporting(false);
    const columns = ["name", "description", "tags", ...ENVIRONMENTS, "last_seen", "created"];
    download(`flags-${fileStamp()}.csv`, toCsv(rows.map((f) => ({
      name: f.name, description: f.description, tags: (f.tags ?? "").split(",").filter(Boolean).join(";"),
      development: f.development, uat: f.uat, production: f.production,
      last_seen: f.last_seen_text || "never", created: f.created_text,
    })), columns), "text/csv");
  }

  // "Not seen in N days" is only reliable once usage has been recorded for N days.
  const since = config?.usage_since_text ? Date.parse(config.usage_since_text) : NaN;
  const reliableFrom = since + unusedDays * DAY;
  const count = loading || error ? "" : `${total}${exact ? "" : "+"}${filtered && everything.lengthExact ? ` of ${everything.length}` : ""} flags`;

  return (
    <section className="flaglist">
      <div className="toolbar">
        <h2>Flags</h2>
        <input ref={searchRef} className="search" placeholder="Search names and descriptions…  ( / )" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        <TagFilter selected={tags} onChange={setTags} />
        <span className="spacer" />
        <span className="muted">{count}</span>
        <button disabled={exporting} onClick={() => void exportCsv()} title="Download the flags shown, as CSV">Export CSV</button>
        {canEditFlags && <button className="primary" onClick={() => setCreating(true)}>+ New flag</button>}
      </div>
      <div className="quicktabs" role="tablist" aria-label="Quick filters">
        {([["all", "All active"], ["stale", "Stale"], ["overrides", "Has brand overrides"], ["unused", `Not seen in ${unusedDays} days`]] as [Quick, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={quick === k} className={quick === k ? "qtab active" : "qtab"} onClick={() => setQuick(k)}>{label}</button>
        ))}
      </div>
      {quick === "unused" && Date.now() < reliableFrom && (
        <p className="note">
          Usage has been recorded since {new Date(since).toLocaleDateString()}; this filter is reliable from {new Date(reliableFrom).toLocaleDateString()}.
          Until then a flag may simply not have been asked for yet.
        </p>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      <div ref={scrollRef} className="scrollbox">
        <table className="grid fixed" aria-label="Flags">
          <colgroup>
            <col style={{ width: "32%" }} />
            {ENVIRONMENTS.map((e) => <col key={e} style={{ width: "13%" }} />)}
            <col style={{ width: "9%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr>
              <SortHeader label="Flag" column="name_sort" sort={sort} onSort={setSort} />
              {ENVIRONMENTS.map((e) => <th key={e}>{e}</th>)}
              <SortHeader label="Last seen" column="last_seen_text" sort={sort} onSort={setSort} />
              <th>Tags</th>
              <SortHeader label="Created" column="created_text" sort={sort} onSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && <tr aria-hidden style={{ height: padTop }} />}
            {visible.map(({ index }) => {
              const f = rowAt(index);
              if (!f) {
                return (
                  <tr key={`loading-${index}`} style={{ height: ROW_HEIGHT }} aria-hidden>
                    <td colSpan={7}><span className="skeleton" /></td>
                  </tr>
                );
              }
              return (
                <tr key={f.id} style={{ height: ROW_HEIGHT }} onClick={() => f.name && navigate(`/flags/${encodeURIComponent(f.name)}`)} className="clickable">
                  <td>
                    <div className="oneline">
                      <Link to={`/flags/${encodeURIComponent(f.name ?? "")}`} className="flagname">{f.name}</Link>
                      {f.stale && <span className="badge badge-stale">stale</span>}
                    </div>
                    {f.description && <div className="desc oneline" title={f.description}>{f.description}</div>}
                  </td>
                  {ENVIRONMENTS.map((e) => {
                    const brands = ({ development: f.development_brands, uat: f.uat_brands, production: f.production_brands })[e];
                    return <td key={e} className={`${ruleClass(f[e])} clip`} title={brands ? `${f[e]}\n${brands}` : f[e] ?? ""}>{f[e]}</td>;
                  })}
                  <td className="muted clip" title={f.last_seen_by_env ?? ""}>{relTime(f.last_seen_text) || "never"}</td>
                  <td className="clip">{(f.tags ?? "").split(",").filter(Boolean).map((t) => <span key={t} className="tag">{t}</span>)}</td>
                  <td className="muted nowrap" title={f.created_text ?? ""}>{f.created_text?.slice(0, 10)}</td>
                </tr>
              );
            })}
            {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }} />}
          </tbody>
        </table>
        {loading && <p className="muted">Loading…</p>}
        {!loading && !error && total === 0 && <p className="muted">No flags match these filters.</p>}
      </div>
      {creating && <NewFlagDialog onClose={() => setCreating(false)} />}
    </section>
  );
});

/** Tags dropdown: pick one or more; the list shows flags carrying every picked tag. */
const TagFilter = observer(({ selected, onChange }: { selected: string[]; onChange: (tags: string[]) => void }) => {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const { items } = useCollection(db.tags.sort("name", "asc"));
  const toggle = (t: string) => onChange(selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]);
  return (
    <div className="dropdown">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        Tags {selected.length > 0 && <span className="countbadge">{selected.length}</span>} ▾
      </button>
      {open && (
        <div className="menu" role="group" aria-label="Tags">
          <p className="muted small">Flags with all of the ticked tags</p>
          {items.map((t) => (
            <label key={t.id} className="menuitem">
              <input type="checkbox" checked={selected.includes(t.name ?? "")} onChange={() => toggle(t.name ?? "")} /> {t.name}
              <span className="muted small"> {t.flags}</span>
            </label>
          ))}
          {items.length === 0 && <p className="muted small">No tags yet.</p>}
          <div className="actions">
            <button disabled={selected.length === 0} onClick={() => onChange([])}>Clear</button>
            <button onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
});
