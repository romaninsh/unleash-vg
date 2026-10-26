import { useState, type FormEvent } from "react";
import { observer, useCollection } from "@vantage-ui/client/react";
import { useDb, usePermissions } from "../../auth";
import { ENVIRONMENTS, friendlyError, relTime, temporaryPassword } from "../../format";
import { ShowOnce } from "../../components/ShowOnce";
import type { UserAdmin } from "../../vantage.gen";

const ROLES = ["viewer", "editor", "admin"];
const SIGN_IN_NOTE =
  "This preview's web sign-in is simulated (password \"demo\"); new or deactivated users take effect after an admin runs tests/sync_web_users.sh. The temporary password is for the real login.";

/** Users (spec 05 screen 9, spec 07, admins): add, role and environments, deactivate, reset password. */
export const UsersPage = observer(() => {
  const db = useDb();
  const { items, error } = useCollection(db.user_admin.sort("name", "asc"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [envs, setEnvs] = useState<string[]>([]);
  const [shown, setShown] = useState<{ who: string; pwd: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const by = usePermissions().email;

  async function add(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const pwd = temporaryPassword();
    const r = await db.user_admin.create({
      name, email: email.trim().toLowerCase(), role, editable_environments: role === "editor" ? envs.join(",") : "",
      active: true, new_password: pwd, admin_scope: "all", updated_by: by,
    });
    if (!r.ok) return setFormError(/already|contains/i.test(r.error.message) ? `A user with email ${email} already exists.` : r.error.message);
    setShown({ who: email, pwd });
    setName("");
    setEmail("");
    setEnvs([]);
  }

  return (
    <section>
      <div className="toolbar"><h2>Users</h2></div>
      <p className="muted">Viewers see everything. Editors create and edit flags and change the environments ticked for them. Admins can do everything.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <table className="grid">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Editable environments</th><th>Last login</th><th>Password changed</th><th>Active</th><th /></tr></thead>
        <tbody>{items.map((u) => <UserRow key={u.id} u={u} onPassword={(pwd) => setShown({ who: u.email ?? "", pwd })} />)}</tbody>
      </table>

      <form className="card addform" onSubmit={add}>
        <h3>Add user</h3>
        <div className="row">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Role<select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
          {role === "editor" && <EnvPicker value={envs} onChange={setEnvs} />}
          <button type="submit" className="primary">Add user</button>
        </div>
        {formError && <p role="alert" className="error">{formError}</p>}
      </form>
      {shown && <ShowOnce title={`Temporary password for ${shown.who}`} label="Temporary password" value={shown.pwd} note={SIGN_IN_NOTE} onClose={() => setShown(null)} />}
    </section>
  );
});

function EnvPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <span className="envpicker">
      {ENVIRONMENTS.map((e) => (
        <label key={e} className="chip">
          <input type="checkbox" checked={value.includes(e)} onChange={(x) => onChange(x.target.checked ? [...value, e] : value.filter((v) => v !== e))} /> {e}
        </label>
      ))}
    </span>
  );
}

const UserRow = observer(({ u, onPassword }: { u: UserAdmin; onPassword: (pwd: string) => void }) => {
  const [role, setRole] = useState<string | null>(null);
  const [envs, setEnvs] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const curRole = role ?? u.role ?? "viewer";
  const curEnvs = envs ?? (u.editable_environments ?? "").split(",").filter(Boolean);
  const dirty = role !== null || envs !== null;
  const by = usePermissions().email;
  const patch = async (fields: Parameters<UserAdmin["patch"]>[0]) => {
    setError(null);
    const r = await u.patch({ ...fields, updated_by: by });
    if (!r.ok) setError(friendlyError(r.error.message));
    return r.ok;
  };
  return (
    <tr className={u.active ? "" : "inactive"}>
      <td>{u.name}</td>
      <td>{u.email}</td>
      <td><select value={curRole} onChange={(e) => setRole(e.target.value)} aria-label={`Role of ${u.email}`}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
      <td>{curRole === "editor" ? <EnvPicker value={curEnvs} onChange={setEnvs} /> : <span className="muted">{curRole === "admin" ? "all" : "—"}</span>}</td>
      <td className="muted">{relTime(u.last_login_text) || "never"}</td>
      <td className="muted" title={u.password_changed_text ?? ""}>
        {relTime(u.password_changed_text) || "never"}
        {u.must_change_password && u.password_changed_text ? <span className="badge badge-stale">temporary</span> : null}
      </td>
      <td>{u.active ? "yes" : "no"}</td>
      <td className="right nowrap">
        {dirty && (
          <button
            className="primary"
            onClick={async () => {
              if (await patch({ role: curRole, editable_environments: curRole === "editor" ? curEnvs.join(",") : "" })) { setRole(null); setEnvs(null); }
            }}
          >
            Save
          </button>
        )}{" "}
        <button
          onClick={async () => {
            if (!confirm(`Reset the password of ${u.email}? They must choose a new one at their next login.`)) return;
            const pwd = temporaryPassword();
            if (await patch({ new_password: pwd })) onPassword(pwd);
          }}
        >
          Reset password
        </button>{" "}
        <button className={u.active ? "danger" : ""} onClick={() => void patch({ active: !u.active })}>{u.active ? "Deactivate" : "Activate"}</button>
        {error && <div role="alert" className="error">{error}</div>}
      </td>
    </tr>
  );
});
