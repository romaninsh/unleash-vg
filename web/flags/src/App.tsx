import { useState, type ReactNode } from "react";
import { createBrowserRouter, NavLink, Outlet, RouterProvider, useLocation } from "react-router";
import { observer } from "@vantage-ui/client/react";
import { signOut, usePermissions } from "./auth";
import { FlagList } from "./pages/FlagList";
import { FlagPage } from "./pages/FlagPage";
import { ArchivePage } from "./pages/ArchivePage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { ConnectedAppsPage } from "./pages/ConnectedAppsPage";
import { BrandsPage } from "./pages/admin/BrandsPage";
import { TokensPage } from "./pages/admin/TokensPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { SettingsPage } from "./pages/admin/SettingsPage";

// A data router: the flag page's "Leave without saving?" guard (useBlocker) needs one.
// Made on first render (the route elements below use components declared further down).
const makeRouter = () => createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <FlagList /> },
      { path: "/flags/:name", element: <FlagPage /> },
      { path: "/archive", element: <ArchivePage /> },
      { path: "/audit-log", element: <AuditLogPage /> },
      { path: "/connected-apps", element: <ConnectedAppsPage /> },
      { path: "/admin/brands", element: <AdminOnly><BrandsPage /></AdminOnly> },
      { path: "/admin/tokens", element: <AdminOnly><TokensPage /></AdminOnly> },
      { path: "/admin/users", element: <AdminOnly><UsersPage /></AdminOnly> },
      { path: "/admin/settings", element: <AdminOnly><SettingsPage /></AdminOnly> },
      { path: "*", element: <p className="muted">Page not found.</p> },
    ],
  },
]);

export function App() {
  const [router] = useState(makeRouter);
  return <RouterProvider router={router} />;
}

function Shell() {
  return (
    <div className="shell">
      <Sidebar />
      <main>
        <Outlet />
      </main>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Flags", icon: "⚑", end: false, match: (p: string) => p === "/" || p.startsWith("/flags/") },
  { to: "/archive", label: "Archive", icon: "🗄" },
  { to: "/audit-log", label: "Audit log", icon: "📋" },
  { to: "/connected-apps", label: "Connected apps", icon: "⇄" },
];

const ADMIN_NAV = [
  { to: "/admin/brands", label: "Brands", icon: "🏦" },
  { to: "/admin/tokens", label: "API tokens", icon: "🔑" },
  { to: "/admin/users", label: "Users", icon: "👥" },
  { to: "/admin/settings", label: "Settings", icon: "⚙" },
];

/** Admin screens: the server refuses their data to anyone else; this explains it. */
const AdminOnly = observer(({ children }: { children: ReactNode }) => {
  const { me, isAdmin } = usePermissions();
  if (!me) return <p className="muted">Loading…</p>;
  return isAdmin ? <>{children}</> : <p className="lock">🔒 Only admins can open this page.</p>;
});

/** Left navigation (spec 05 "Navigation"); the Admin section shows for admins only. */
const Sidebar = observer(() => {
  const { me, role, isAdmin } = usePermissions();
  const { pathname } = useLocation();
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">⚑ Flag Service</div>
      <ul>
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to !== "/"}
              className={({ isActive }) => {
                const active = item.match ? item.match(pathname) : isActive;
                return active ? "navlink active" : "navlink";
              }}
            >
              <span className="navicon" aria-hidden>{item.icon}</span> {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      {isAdmin && (
        <>
          <div className="navsection">Admin</div>
          <ul>
            {ADMIN_NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={({ isActive }) => (isActive ? "navlink active" : "navlink")}>
                  <span className="navicon" aria-hidden>{item.icon}</span> {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}
      <span className="spacer" />
      {me && (
        <div className="who">
          <div className="whoname">{me.name}</div>
          <div className="muted small">{me.email}</div>
          <span className={`role role-${role}`}>{role}</span>
          {role === "editor" && <div className="muted small">edits {me.editable_environments?.replace(/,/g, ", ") || "no environments"}</div>}
        </div>
      )}
      <button className="signout" onClick={signOut}>Sign out</button>
    </nav>
  );
});
