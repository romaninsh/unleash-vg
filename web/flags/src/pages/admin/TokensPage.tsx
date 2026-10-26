import { useState, type FormEvent } from "react";
import { observer, useCollection } from "@vantage-ui/client/react";
import { useDb, usePermissions } from "../../auth";
import { ENVIRONMENTS, friendlyError, randomHex, relTime } from "../../format";
import { ShowOnce } from "../../components/ShowOnce";
import type { TokenAdmin } from "../../vantage.gen";

/** API tokens (spec 04, spec 05 screen 8, admins). Secrets are never stored or shown again. */
export const TokensPage = observer(() => {
  const db = useDb();
  const { email } = usePermissions();
  const { items, error } = useCollection(db.token_admin.sort("name", "asc"));
  const [mode, setMode] = useState<"create" | "import">("create");
  const [name, setName] = useState("");
  const [type, setType] = useState("backend");
  const [env, setEnv] = useState("production");
  const [secret, setSecret] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const imported = mode === "import";
    // New secrets use Unleash's v1 format: default:<environment>.<56 hex> (28 random bytes).
    const value = imported ? secret.trim() : `default:${env}.${randomHex(28)}`;
    if (imported && value.length < 24) return setFormError("That doesn't look like an Unleash token secret.");
    const r = await db.token_admin.create({
      name, type: type === "client" ? "backend" : type, environment: env, source: imported ? "imported" : "created",
      new_secret: value, created_by: email, admin_scope: "all",
    });
    if (!r.ok) return setFormError(friendlyError(r.error.message));
    setName("");
    setSecret("");
    if (!imported) setShown(value);
  }

  return (
    <section>
      <div className="toolbar"><h2>API tokens</h2></div>
      <p className="muted">Backend tokens are for server SDKs, frontend tokens for web and mobile apps. Revoking takes effect within 30 seconds.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <table className="grid">
        <thead><tr><th>Name</th><th>Type</th><th>Environment</th><th>Secret starts with</th><th>Source</th><th>Created</th><th>Last used</th><th /></tr></thead>
        <tbody>{items.map((t) => <TokenRow key={t.id} t={t} />)}</tbody>
      </table>

      <form className="card addform" onSubmit={submit}>
        <div className="titlerow">
          <h3>{mode === "create" ? "Create token" : "Import existing Unleash secret"}</h3>
          <button type="button" className="link" onClick={() => setMode(mode === "create" ? "import" : "create")}>
            {mode === "create" ? "Import an existing secret instead" : "Create a new token instead"}
          </button>
        </div>
        <div className="row">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="payments-service prod" required /></label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="backend">backend</option>
              <option value="frontend">frontend</option>
              {mode === "import" && <option value="client">client (legacy, = backend)</option>}
            </select>
          </label>
          <label>
            Environment
            <select value={env} onChange={(e) => setEnv(e.target.value)}>{ENVIRONMENTS.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
          {mode === "import" && (
            <label className="grow">Secret<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} required autoComplete="off" /></label>
          )}
          <button type="submit" className="primary" disabled={!name.trim()}>{mode === "create" ? "Create" : "Import"}</button>
        </div>
        {formError && <p role="alert" className="error">{formError}</p>}
      </form>
      {shown && (
        <ShowOnce title="Copy the secret now" label="Secret" value={shown} note="Put it in the app's configuration as its Unleash API token." onClose={() => setShown(null)} />
      )}
    </section>
  );
});

const TokenRow = observer(({ t }: { t: TokenAdmin }) => {
  const { email } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  return (
    <tr>
      <td>{t.name}</td>
      <td className={t.type === "frontend" ? "rule-partial" : ""}>{t.type}</td>
      <td>{t.env_key}</td>
      <td className="mono small">{t.hint}</td>
      <td>{t.source}</td>
      <td className="muted" title={t.created_text ?? ""}>{relTime(t.created_text)}</td>
      <td className="muted" title={t.last_used_text ?? ""}>{relTime(t.last_used_text) || "never"}</td>
      <td className="right">
        <button
          className="danger"
          onClick={async () => {
            if (!confirm(`Revoke "${t.name}"? Apps using it get 401 within 30 seconds.`)) return;
            // so the history names who revoked it
            const marked = await t.patch({ updated_by: email });
            if (!marked.ok) return setError(friendlyError(marked.error.message));
            const r = await t.delete();
            if (!r.ok) setError(friendlyError(r.error.message));
          }}
        >
          Revoke
        </button>
        {error && <div role="alert" className="error">{error}</div>}
      </td>
    </tr>
  );
});
