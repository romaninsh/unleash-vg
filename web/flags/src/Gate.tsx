import { useState, type FormEvent, type ReactNode } from "react";
import { useConnection } from "@vantage-ui/client/react";
import { readToken, saveToken, useDb } from "./auth";

/** Shows the sign-in form until the server accepts the token, then the app. */
export function Gate({ children }: { children?: ReactNode }) {
  const { status, error } = useConnection();
  if (status === "refused") return <SignIn failed={readToken() !== undefined} detail={error} />;
  if (status === "protocol_mismatch") return <p role="alert" className="notice">This page is out of date. Reload it. ({error})</p>;
  return <>{children ?? <p className="notice">Connecting…</p>}</>;
}

function SignIn({ failed, detail }: { failed: boolean; detail?: string }) {
  const db = useDb();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    saveToken(email, password);
    const connection = await db.reconnect();
    setBusy(false);
    // Don't say which field was wrong (spec 05, Login).
    if (connection.halted) setMessage("Invalid credentials");
  }

  return (
    <div className="signin">
      <form onSubmit={submit} className="card">
        <h1>Flag Service</h1>
        <p className="muted">Sign in with your work email.</p>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {(message ?? (failed ? "Invalid credentials" : null)) && (
          <p role="alert" className="error" title={detail}>{message ?? "Invalid credentials"}</p>
        )}
        <button type="submit" className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="hint">Simulated sign-in for this preview: every staff account uses the password <b>demo</b>.</p>
      </form>
    </div>
  );
}
