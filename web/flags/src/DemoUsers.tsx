// The seeded users (tests/seed.surql), offered on the sign-in screen of the hosted demo and in
// local development. A build for real use leaves VITE_DEMO_SIGN_IN unset and shows the plain form.

const PASSWORD = "demo";

// Grouped by role; `limits` says what that person can't do (spec 07, Roles and permissions).
const ROLES = [
  {
    title: "Admin",
    about: "Everything, in every environment.",
    users: [
      { name: "Admin", email: "admin@example.com", limits: "Only admins manage brands, API tokens, users and settings, and delete archived flags." },
    ],
  },
  {
    title: "Editors",
    about: "Create flags and edit their description, tags, stale and archive. Switches, rules and brand overrides only in their own environments.",
    users: [
      { name: "Maria Lopez", email: "maria.lopez@example.com", limits: "development, uat and production. No admin screens." },
      { name: "Jon Reed", email: "jon.reed@example.com", limits: "development, uat and production. No admin screens." },
      { name: "Tom Berg", email: "tom.berg@example.com", limits: "development and uat; production is read-only." },
      { name: "Ana Silva", email: "ana.silva@example.com", limits: "development and uat; production is read-only." },
    ],
  },
  {
    title: "Viewers",
    about: "Read every flag, rule, history entry and metric, and export them.",
    users: [
      { name: "Support Desk", email: "support@example.com", limits: "Changes nothing." },
    ],
  },
];

// Read as one variable so a build without it drops the list entirely.
export const demoSignIn = () => import.meta.env.VITE_DEMO_SIGN_IN === "1";

export function DemoUsers({ onPick }: { onPick: (email: string, password: string) => void }) {
  return (
    <aside className="demo-users card">
      <p className="hint">Demo accounts, all with the password <b>demo</b>. Pick one to fill in the form.</p>
      {ROLES.map((r) => (
        <section key={r.title}>
          <h3>{r.title}</h3>
          <p className="muted small">{r.about}</p>
          {r.users.map((u) => (
            <button key={u.email} type="button" onClick={() => onPick(u.email, PASSWORD)}>
              <b>{u.name}</b> <span className="muted">{u.email}</span>
              <span className="small">{u.limits}</span>
            </button>
          ))}
        </section>
      ))}
    </aside>
  );
}
