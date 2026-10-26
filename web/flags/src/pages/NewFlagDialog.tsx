import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useDb, usePermissions } from "../auth";

/** Turns the database's refusal into a sentence for the person. */
function explain(message: string, name: string): string {
  if (/already (exists|contains)/i.test(message)) return `A flag called ${name} already exists (it may be archived).`;
  if (message.includes("field `name`")) return "Use only letters, digits, dot, dash and underscore (max 100).";
  if (message.includes("field `tags`")) return "Tags may only use a-z, 0-9, colon, underscore and dash (max 50 each).";
  if (message.includes("field `description`") && message.includes("conform")) return "The description can be at most 2000 characters.";
  if (/outside your scope/i.test(message)) return "You don't have permission to create flags.";
  return message;
}

/** "New flag": the database creates all three environments switched off, and logs it. */
export function NewFlagDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const navigate = useNavigate();
  const { email } = usePermissions();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = /^[A-Za-z0-9._-]{1,100}$/.test(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // The record id is the flag name (flag:<name>); edit_scope is what the API's permission rule checks.
    // Empty fields are left out: the database refuses null for optional text.
    const r = await db.flag_edits.create({
      id: name,
      name,
      ...(description.trim() && { description }),
      ...(tags.trim() && { tags }),
      edit_scope: "all",
      created_by: email,
    });
    setBusy(false);
    if (!r.ok) return setError(explain(r.error.message, name));
    onClose();
    navigate(`/flags/${encodeURIComponent(name)}`);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card dialog" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h3>New flag</h3>
        <p className="muted">Letters, digits, dot, dash and underscore. The name can't be changed later and must differ from every flag, archived ones included. The flag starts switched off everywhere.</p>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. debit-card-payments" autoFocus required />
        </label>
        {name && !nameOk && <p className="error">Use only letters, digits, dot, dash and underscore (max 100).</p>}
        <label>
          Description
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Tags
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. payments, team:cards" />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !nameOk}>{busy ? "Creating…" : "Create"}</button>
        </div>
      </form>
    </div>
  );
}
