import { observer, useCollection } from "@vantage-ui/client/react";
import { useDb } from "../auth";
import { relTime } from "../format";

/** Connected apps (spec 05 screen 6) and the flag names apps ask for that don't exist. */
export const ConnectedAppsPage = observer(() => {
  const db = useDb();
  const apps = useCollection(db.apps.sort("app_name", "asc"));
  const unknown = useCollection(db.unknown_flags.sort("last_seen_at", "desc"));
  return (
    <section>
      <div className="toolbar"><h2>Connected apps</h2></div>
      <p className="muted">Apps that registered or sent usage in the last 7 days — which services use an old SDK, and is production actually calling us.</p>
      {apps.error && <p role="alert" className="error">{apps.error}</p>}
      <table className="grid">
        <thead>
          <tr><th>App</th><th>Environment</th><th>SDK version</th><th>Instances</th><th>Last seen</th></tr>
        </thead>
        <tbody>
          {apps.items.map((a) => (
            <tr key={a.id}>
              <td>{a.app_name}</td>
              <td>{a.environment}</td>
              <td className="mono small">{a.sdk_version}</td>
              <td>{a.instances}</td>
              <td className="muted" title={a.last_seen_at ?? ""}>{relTime(a.last_seen_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="section">Unknown flag names</h3>
      <p className="muted">Apps ask for these but no such flag exists — usually a typo in the app.</p>
      <table className="grid">
        <thead>
          <tr><th>Flag name</th><th>Environment</th><th>App</th><th>Evaluations</th><th>Last seen</th></tr>
        </thead>
        <tbody>
          {unknown.items.map((u) => (
            <tr key={u.id}>
              <td className="mono rule-only">{u.name}</td>
              <td>{u.environment}</td>
              <td>{u.app_name}</td>
              <td>{u.count}</td>
              <td className="muted" title={u.last_seen_at ?? ""}>{relTime(u.last_seen_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unknown.loadState !== "loading" && unknown.items.length === 0 && <p className="muted">None — every name apps ask for exists.</p>}
    </section>
  );
});
