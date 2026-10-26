import { useState, type FormEvent } from "react";
import { observer, useCollection } from "@vantage-ui/client/react";
import { useDb } from "../../auth";
import { friendlyError } from "../../format";
import type { BrandAdmin } from "../../vantage.gen";

/** Brands (spec 05 screen 7, admins): add, rename, activate/deactivate, delete when unused. */
export const BrandsPage = observer(() => {
  const db = useDb();
  const { items, error } = useCollection(db.brand_admin.sort("key", "asc"));
  // overrides per brand key (one per flag environment)
  const overrides = new Map<string, number>();
  for (const o of useCollection(db.overrides.all).items) if (o.brand_key) overrides.set(o.brand_key, (overrides.get(o.brand_key) ?? 0) + 1);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const keyOk = /^[a-z0-9][a-z0-9-]{0,62}$/.test(key);

  async function add(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    const r = await db.brand_admin.create({ id: key, key, display_name: name.trim(), active: true, admin_scope: "all" });
    if (!r.ok) return setAddError(/already|exists|contains/i.test(r.error.message) ? `A brand with key ${key} already exists.` : friendlyError(r.error.message));
    setKey("");
    setName("");
  }

  return (
    <section>
      <div className="toolbar"><h2>Brands</h2></div>
      <p className="muted">
        The key is the exact value apps send as the brand (case-sensitive) and can't be changed. Inactive brands can't get new
        overrides; existing ones still apply. A brand with overrides can't be deleted — deactivate it instead. Click a name to
        rename it (Enter saves, Esc cancels).
      </p>
      {error && <p role="alert" className="error">{error}</p>}
      <table className="grid">
        <thead><tr><th>Key</th><th>Name</th><th>Active</th><th>Flags with overrides</th><th /></tr></thead>
        <tbody>{items.map((b) => <BrandRow key={b.id} b={b} overrides={overrides.get(b.key ?? "") ?? 0} />)}</tbody>
      </table>
      <form className="card addform" onSubmit={add}>
        <h3>Add brand</h3>
        <div className="row">
          <label>Key<input value={key} onChange={(e) => setKey(e.target.value)} placeholder="bank-g" required maxLength={63} /></label>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bank G" required maxLength={100} /></label>
          <button type="submit" className="primary" disabled={!keyOk || !name.trim()}>Add brand</button>
        </div>
        {key && !keyOk && <p className="error">Lowercase letters, digits and dashes; start with a letter or digit.</p>}
        {addError && <p role="alert" className="error">{addError}</p>}
      </form>
    </section>
  );
});

const BrandRow = observer(({ b, overrides }: { b: BrandAdmin; overrides: number }) => {
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (p: Promise<{ ok: boolean; error?: { message: string } }>) => {
    setError(null);
    const r = await p;
    if (!r.ok) setError(friendlyError(r.error?.message ?? "Failed"));
    return r.ok;
  };
  const rename = async () => {
    if (name === null || !name.trim() || name === b.display_name) return setName(null);
    if (await run(b.patch({ display_name: name.trim() }))) setName(null);
  };
  const used = overrides > 0;
  return (
    <tr>
      <td className="mono">{b.key}</td>
      <td>
        {name === null ? (
          <button className="link" onClick={() => setName(b.display_name ?? "")} title="Rename">{b.display_name}</button>
        ) : (
          <input
            autoFocus value={name} maxLength={100} aria-label={`Name of ${b.key}`}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setName(null); }}
            onBlur={() => void rename()}
          />
        )}
      </td>
      <td>
        <label className="chip">
          <input type="checkbox" checked={!!b.active} onChange={(e) => void run(b.patch({ active: e.target.checked }))} /> {b.active ? "active" : "inactive"}
        </label>
      </td>
      <td>{overrides}</td>
      <td className="right">
        <button
          className="danger"
          disabled={used}
          title={used ? "Has overrides - deactivate it instead" : ""}
          onClick={async () => {
            if (!confirm(`Delete brand ${b.key}?\nApps that still send "${b.key}" will get the default rule.`)) return;
            await run(b.delete());
          }}
        >
          Delete
        </button>
        {error && <div role="alert" className="error">{error}</div>}
      </td>
    </tr>
  );
});
