// SIMULATED sign-in: the API accepts "<email>:<password>" as its token (api/flags.yaml lists one
// per person, password "demo"). Real login belongs in the flag service (spec 07).
import { useCollection, useVantage } from "@vantage-ui/client/react";
import type { Me, Schema } from "./vantage.gen";

const KEY = "flags.token";

export const readToken = (): string | undefined => sessionStorage.getItem(KEY) ?? undefined;
export const saveToken = (email: string, password: string) =>
  sessionStorage.setItem(KEY, `${email.trim().toLowerCase()}:${password}`);
export const clearToken = () => sessionStorage.removeItem(KEY);

/** Forget the token and start over at the sign-in page (a full reload drops all loaded data). */
export function signOut() {
  clearToken();
  window.location.assign("/");
}

export const useDb = () => useVantage<Schema>();

export interface Permissions {
  me: Me | undefined;
  email: string;
  role: string;
  canEditFlags: boolean;
  isAdmin: boolean;
  canEditEnv: (env: string) => boolean;
}

/** The settings every page may read: unused-flag days, usage start, context field names. */
export function useConfig() {
  const db = useDb();
  return useCollection(db.config.all).items[0];
}

/** The signed-in person and what they may change. The server enforces the same rules. */
export function usePermissions(): Permissions {
  const db = useDb();
  const { items } = useCollection(db.me.all);
  const me = items[0];
  const role = me?.role ?? "viewer";
  const envs = (me?.editable_environments ?? "").split(",").filter(Boolean);
  return {
    me,
    email: me?.email ?? "",
    role,
    canEditFlags: role === "editor" || role === "admin",
    isAdmin: role === "admin",
    canEditEnv: (env) => role === "admin" || (role === "editor" && envs.includes(env)),
  };
}
