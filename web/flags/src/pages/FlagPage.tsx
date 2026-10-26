import { useEffect, useMemo, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { observer, useCollection, useRecord } from "@vantage-ui/client/react";
import { useDb, usePermissions } from "../auth";
import { ENVIRONMENTS, friendlyError, relTime, ruleClass, type Env } from "../format";
import { EnvironmentCard } from "./EnvironmentCard";
import type { Draft } from "./card-draft";

type Summary = {
  name: string | null; description: string | null; tags: string | null; stale: boolean | null;
  development: string | null; uat: string | null; production: string | null;
  created_text: string | null; created_by: string | null;
};

/** Flag detail (spec 05 screen 3): one card per environment, history, and the flag's details. */
export const FlagPage = observer(() => {
  const { name = "" } = useParams();
  const db = useDb();
  const [env, setEnv] = useState<Env>("production");
  const live = useCollection(db.flags.where({ name }));
  const gone = useCollection(db.archived.where({ name }));
  const archived = gone.items[0];
  const flag: Summary | undefined = live.items[0] ?? archived;
  // staged edits per environment, kept while switching tabs; which of them differ from saved
  const [drafts, setDrafts] = useState<Partial<Record<Env, Draft | null>>>({});
  const [dirty, setDirty] = useState<Partial<Record<Env, boolean>>>({});
  const dirtyEnvs = ENVIRONMENTS.filter((e) => dirty[e]);
  const onDirty = useMemo(() => Object.fromEntries(ENVIRONMENTS.map((e) => [e, (d: boolean) => setDirty((x) => (x[e] === d ? x : { ...x, [e]: d }))])) as Record<Env, (d: boolean) => void>, []);

  // Leaving with unsaved changes asks first (in-app links; the browser asks on close / reload).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyEnvs.length > 0 && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (dirtyEnvs.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyEnvs.length]);

  if (!flag) {
    const loading = live.loadState === "loading" || gone.loadState === "loading";
    return <p className="muted">{loading ? "Loading…" : `No flag called ${name}.`}</p>;
  }

  return (
    <section>
      <p className="crumbs">{archived ? <Link to="/archive">Archive</Link> : <Link to="/">Flags</Link>} / {name}</p>
      <div className="titlerow">
        <h2 className="mono">{name}</h2>
        <CopyName name={name} />
        {flag.stale && <span className="badge badge-stale">stale</span>}
        {archived && <span className="badge badge-archived">archived</span>}
        <span className="spacer" />
        {!archived && <FlagActions name={name} stale={!!flag.stale} />}
      </div>
      {archived && (
        <p className="banner">
          Archived {relTime(archived.archived_text)} by {archived.archived_by ?? "someone"}. Apps don't receive it; the page is read-only.
          Revive or delete it from the <Link to="/archive">Archive</Link>.
        </p>
      )}
      <div className="layout">
        <div className="maincol">
          <div className="tabs" role="tablist">
            {ENVIRONMENTS.map((e) => (
              <button key={e} role="tab" aria-selected={env === e} className={env === e ? "tab active" : "tab"} onClick={() => setEnv(e)}>
                {e} {dirty[e] && <span className="dot" title="Unsaved changes">●</span>}
                <span className={`tabrule ${ruleClass(flag[e])}`}>{flag[e]}</span>
              </button>
            ))}
          </div>
          <EnvironmentCard
            key={env} flag={name} env={env} archived={!!archived}
            draft={drafts[env] ?? null} setDraft={(d) => setDrafts((x) => ({ ...x, [env]: d }))} onDirty={onDirty[env]}
          />
          <History flag={name} />
        </div>
        <aside className="sidecol">
          <About flag={flag} archived={!!archived} />
          <Usage flag={name} />
        </aside>
      </div>
      {blocker.state === "blocked" && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Leave without saving?">
          <div className="dialog">
            <h3>Leave without saving?</h3>
            <p>You have unsaved changes in {dirtyEnvs.join(", ")}.</p>
            <div className="actions">
              <button onClick={() => blocker.reset()}>Stay</button>
              <button className="danger" onClick={() => blocker.proceed()}>Leave</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});

function CopyName({ name }: { name: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="link" title="Copy name" onClick={() => { void navigator.clipboard?.writeText(name); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? "✓ copied" : "⧉ copy"}
    </button>
  );
}

/** "⋮": mark stale / archive (editors and admins). */
const FlagActions = observer(({ name, stale }: { name: string; stale: boolean }) => {
  const db = useDb();
  const navigate = useNavigate();
  const { canEditFlags, email } = usePermissions();
  const editRef = useMemo(() => db.flag_edits.ref(`flag:${name}`), [db, name]);
  const edit = useRecord(editRef);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canEditFlags) return null;

  async function save(fields: { stale?: boolean; archived?: boolean }) {
    setOpen(false);
    if (!edit.value) return;
    const r = await edit.value.patch({ ...fields, updated_by: email });
    if (!r.ok) return setError(friendlyError(r.error.message));
    if (fields.archived) navigate("/archive");
  }

  return (
    <div className="dropdown">
      <button aria-label="Flag actions" aria-expanded={open} onClick={() => setOpen(!open)}>⋮</button>
      {open && (
        <div className="menu right" role="menu">
          <button role="menuitem" className="menuitem" onClick={() => void save({ stale: !stale })}>{stale ? "Unmark stale" : "Mark stale"}</button>
          <button
            role="menuitem" className="menuitem danger"
            onClick={() => {
              if (confirm(`Archive ${name}?\nApps stop receiving it at once. If it is revived later, it comes back OFF in every environment with its rules kept.`)) void save({ archived: true });
            }}
          >
            Archive…
          </button>
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
});

/** Description (inline edit), tags (chips + suggestions), created. */
const About = observer(({ flag, archived }: { flag: Summary; archived: boolean }) => {
  const db = useDb();
  const { canEditFlags, email } = usePermissions();
  const can = canEditFlags && !archived;
  const editRef = useMemo(() => db.flag_edits.ref(`flag:${flag.name}`), [db, flag.name]);
  const edit = useRecord(editRef);
  const known = useCollection(db.tags.sort("name", "asc")).items;
  const [description, setDescription] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tags = (flag.tags ?? "").split(",").filter(Boolean);

  async function save(fields: { description?: string; tags?: string }) {
    if (!edit.value) return false;
    setError(null);
    const r = await edit.value.patch({ ...fields, updated_by: email });
    if (!r.ok) { setError(friendlyError(r.error.message)); return false; }
    return true;
  }
  async function addTag() {
    const t = newTag.trim().toLowerCase();
    if (!t) return;
    if (!/^[a-z0-9:_-]{1,50}$/.test(t)) return setError(`"${t}" isn't a valid tag: lowercase letters, digits, ":", "_" and "-", up to 50.`);
    if (await save({ tags: [...tags, t].join(",") })) setNewTag("");
  }

  return (
    <div className="card">
      <h3>About this flag</h3>
      {!canEditFlags && <p className="lock">🔒 Viewers can't change flags.</p>}
      <div className="field">
        <span className="label">Description</span>
        {description === null ? (
          <p className="desctext">
            {flag.description || <span className="muted">No description.</span>}{" "}
            {can && <button className="link" onClick={() => setDescription(flag.description ?? "")}>edit</button>}
          </p>
        ) : (
          <>
            <textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
            <div className="actions">
              <button onClick={() => setDescription(null)}>Cancel</button>
              <button className="primary" onClick={() => void save({ description }).then((ok) => ok && setDescription(null))}>Save</button>
            </div>
          </>
        )}
      </div>
      <div className="field">
        <span className="label">Tags</span>
        <div>
          {tags.map((t) => (
            <span key={t} className="tag">
              {t}
              {can && <button className="tagx" aria-label={`Remove tag ${t}`} onClick={() => void save({ tags: tags.filter((x) => x !== t).join(",") })}>×</button>}
            </span>
          ))}
          {tags.length === 0 && <span className="muted small">No tags.</span>}
        </div>
        {can && (
          <div className="row">
            <input list="known-tags" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addTag()} placeholder="Add a tag" aria-label="Add a tag" />
            <datalist id="known-tags">{known.filter((k) => !tags.includes(k.name ?? "")).map((k) => <option key={k.id} value={k.name ?? ""} />)}</datalist>
            <button onClick={() => void addTag()} disabled={!newTag.trim()}>Add</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <p className="muted small">Created {relTime(flag.created_text)} by {flag.created_by}</p>
    </div>
  );
});

/** Last seen and yes/no counts for every environment at once (spec 08). */
const Usage = observer(({ flag }: { flag: string }) => {
  const db = useDb();
  const rows = useCollection(db.usage.where({ flag_name: flag })).items;
  return (
    <div className="card">
      <h3>Usage</h3>
      <table className="grid compact">
        <thead><tr><th /><th>Last seen</th><th>24 h</th><th>7 d</th></tr></thead>
        <tbody>
          {ENVIRONMENTS.map((e) => {
            const r = rows.find((x) => x.env_key === e);
            return (
              <tr key={e}>
                <td>{e}</td>
                <td className="muted" title={r?.seen_text ?? ""}>{!r ? "…" : r.seen_text === "never" ? "never" : relTime(r.seen_text)}</td>
                <td className="small">{r?.usage_day}</td>
                <td className="small">{r?.usage_week}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Counts are yes / no answers apps reported; they can be up to a minute behind.</p>
    </div>
  );
});

/** The audit log for this flag (spec 05 screen 3, History). */
const History = observer(({ flag }: { flag: string }) => {
  const db = useDb();
  const { items } = useCollection(db.history.where({ flag }).sort("created_at", "desc").limit(50));
  return (
    <div className="card">
      <h3>History</h3>
      <table className="grid compact">
        <tbody>
          {items.map((h) => (
            <tr key={h.id}>
              <td className="muted nowrap" title={h.created_text ?? ""}>{relTime(h.created_text)}</td>
              <td className="nowrap">{h.created_by}</td>
              <td>{h.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p className="muted">No changes yet.</p>}
      <p className="small"><Link to={`/audit-log?flag=${encodeURIComponent(flag)}`}>Open in the audit log</Link></p>
    </div>
  );
});
