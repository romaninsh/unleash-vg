import { useState } from "react";
import { useNavigate } from "react-router";
import { observer, useCollection } from "@vantage-ui/client/react";
import { useDb, usePermissions } from "../auth";
import { friendlyError, relTime } from "../format";
import type { Archived } from "../vantage.gen";

/** Archive (spec 05 screen 4): revive (editors, admins) and delete permanently (admins). */
export const ArchivePage = observer(() => {
  const db = useDb();
  const { items, loadState, error } = useCollection(db.archived.sort("archived_at", "desc"));
  return (
    <section>
      <div className="toolbar"><h2>Archive</h2></div>
      <p className="muted">
        Archived flags are invisible to apps. Revive brings the rules back with every environment switched off.
        Delete removes the flag for good and frees its name; its history stays in the audit log.
      </p>
      {error && <p role="alert" className="error">{error}</p>}
      <table className="grid">
        <thead>
          <tr><th>Flag</th><th>Archived</th><th>By</th><th /></tr>
        </thead>
        <tbody>{items.map((f) => <ArchivedRow key={f.id} flag={f} />)}</tbody>
      </table>
      {loadState !== "loading" && items.length === 0 && <p className="muted">Nothing is archived.</p>}
    </section>
  );
});

const ArchivedRow = observer(({ flag }: { flag: Archived }) => {
  const db = useDb();
  const navigate = useNavigate();
  const { canEditFlags, isAdmin, email } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const name = flag.name ?? "";

  async function revive() {
    if (!confirm(`Revive ${name}? Its rules come back with every environment switched off.`)) return;
    setError(null);
    const edit = await db.flag_edits.ref(`flag:${name}`).load();
    if (!edit) return setError("You can't revive flags.");
    const r = await edit.patch({ archived: false, updated_by: email });
    if (!r.ok) return setError(friendlyError(r.error.message));
    navigate(`/flags/${encodeURIComponent(name)}`);
  }

  async function remove() {
    const typed = prompt(`This deletes ${name} permanently. Its history stays in the audit log.\n\nType the flag name to confirm:`);
    if (typed === null) return;
    if (typed !== name) return setError("The name didn't match; nothing was deleted.");
    setError(null);
    const target = await db.flag_deletes.ref(`flag:${name}`).load();
    if (!target) return setError("Only admins can delete flags permanently.");
    await target.patch({ updated_by: email }); // so the audit log names who deleted it
    const r = await target.delete();
    if (!r.ok) setError(friendlyError(r.error.message));
  }

  return (
    <tr>
      <td>
        <span className="flagname">{name}</span>
        {flag.description && <div className="desc">{flag.description}</div>}
      </td>
      <td className="muted nowrap" title={flag.archived_at ?? ""}>{relTime(flag.archived_at)}</td>
      <td>{flag.archived_by}</td>
      <td className="nowrap right">
        {canEditFlags && <button onClick={() => void revive()}>Revive</button>}{" "}
        {isAdmin && <button className="danger" onClick={() => void remove()}>Delete permanently</button>}
        {error && <div role="alert" className="error">{error}</div>}
      </td>
    </tr>
  );
});
