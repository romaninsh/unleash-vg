// The seeded users (tests/seed.surql), offered on the sign-in screen of the hosted demo and in
// local development. A build for real use leaves VITE_DEMO_SIGN_IN unset and shows the plain form.

const PASSWORD = "demo";

const USERS = [
  { name: "Admin", email: "admin@example.com", role: "admin", environments: "" },
  { name: "Maria Lopez", email: "maria.lopez@example.com", role: "editor", environments: "development, uat, production" },
  { name: "Tom Berg", email: "tom.berg@example.com", role: "editor", environments: "development, uat" },
  { name: "Ana Silva", email: "ana.silva@example.com", role: "editor", environments: "development, uat" },
  { name: "Jon Reed", email: "jon.reed@example.com", role: "editor", environments: "development, uat, production" },
  { name: "Support Desk", email: "support@example.com", role: "viewer", environments: "" },
];

// Read as one variable so a build without it drops the list entirely.
export const demoSignIn = () => import.meta.env.VITE_DEMO_SIGN_IN === "1";

export function DemoUsers({ onPick }: { onPick: (email: string, password: string) => void }) {
  return (
    <div className="demo-users">
      <p className="hint">Demo accounts: pick one to fill in the form.</p>
      {USERS.map((u) => (
        <button key={u.email} type="button" onClick={() => onPick(u.email, PASSWORD)}>
          <b>{u.name}</b> <span className="muted">{u.role}{u.environments && ` · ${u.environments}`}</span>
        </button>
      ))}
    </div>
  );
}
