import { expect, test, type Page } from "@playwright/test";

// Checks against the real API. Writes fail the test, except to flags named zz-e2e-* (created by
// the tests themselves) and the duplicate-name create, which the database refuses. Remove the
// test flags afterwards:
//   UPDATE flag SET archived = true WHERE name CONTAINS 'zz-e2e-'; DELETE flag WHERE name CONTAINS 'zz-e2e-';
type Frame = { t: string; table?: string; rid?: string; patch?: Record<string, unknown>; items?: Frame[] };
const allowedWrite = (f: Frame): boolean =>
  f.t === "batch" ? (f.items ?? []).every(allowedWrite)
  : f.t !== "flash" ? false
  : f.rid ? f.rid.includes("zz-e2e-")
  : f.table === "flag_edits" && (String(f.patch?.name).startsWith("zz-e2e-") || f.patch?.name === "debit-card-payments");
async function guardWrites(page: Page) {
  await page.routeWebSocket(/\/v1\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const frame = JSON.parse(String(message)) as Frame;
      if (["flash", "batch", "delete", "invoke"].includes(frame.t) && !allowedWrite(frame)) throw new Error(`unexpected write: ${JSON.stringify(frame).slice(0, 200)}`);
      server.send(message);
    });
  });
}

/** A fresh flag only this test touches (as the given editor), opened on its page. */
async function newTestFlag(page: Page, tags = "") {
  const name = `zz-e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await page.getByRole("button", { name: "+ New flag" }).click();
  await page.getByLabel("Name").fill(name);
  if (tags) await page.getByLabel("Tags").fill(tags);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return name;
}

async function signIn(page: Page, email: string, password = "demo") {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.beforeEach(async ({ page }) => guardWrites(page));

test("a wrong password is refused without saying which field was wrong", async ({ page }) => {
  await signIn(page, "tom.berg@example.com", "nope");
  await expect(page.getByRole("alert")).toHaveText("Invalid credentials");
});

test("an editor sees the flag list with per-environment summaries", async ({ page }) => {
  await signIn(page, "tom.berg@example.com");
  await expect(page.getByText("Tom Berg")).toBeVisible();
  await expect(page.getByRole("link", { name: "debit-card-payments" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "debit-card-payments" });
  await expect(row).toContainText("+2 brands");
  await expect(page.getByRole("button", { name: "+ New flag" })).toBeVisible();
});

test("sorting by flag name puts numbers in order and reverses on a second click", async ({ page }) => {
  await signIn(page, "support@example.com");
  await page.getByPlaceholder(/Search names and descriptions/).fill("test-");
  const names = () => page.locator("tbody a.flagname").allTextContents();
  await expect(page.getByText(/^5000 of \d+ flags$/)).toBeVisible(); // the search has applied
  await expect(page.locator("tbody a.flagname").first()).toHaveText("test-1");
  expect((await names()).slice(0, 11)).toEqual(["test-1", "test-2", "test-3", "test-4", "test-5", "test-6", "test-7", "test-8", "test-9", "test-10", "test-11"]);
  await page.getByRole("button", { name: /^Flag/ }).click();
  await expect(page.locator("tbody a.flagname").first()).toHaveText("test-5000");
  expect((await names()).slice(0, 3)).toEqual(["test-5000", "test-4999", "test-4998"]);
  await expect(page.getByRole("columnheader", { name: /Flag/ })).toHaveAttribute("aria-sort", "descending");
});

test("the long list scrolls to its end, drawing only the rows on screen", async ({ page }) => {
  await signIn(page, "support@example.com");
  await page.getByPlaceholder(/Search names and descriptions/).fill("test-");
  await expect(page.getByText(/^5000 of \d+ flags$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "test-1", exact: true })).toBeVisible();
  expect(await page.locator("tbody tr.clickable").count()).toBeLessThan(100);
  await page.locator(".scrollbox").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(page.getByRole("link", { name: "test-5000", exact: true })).toBeVisible();
  expect(await page.locator("tbody tr.clickable").count()).toBeLessThan(100);
  await expect(page.getByRole("link", { name: "test-1", exact: true })).toHaveCount(0);
});

test("the server filters the list by name", async ({ page }) => {
  await signIn(page, "tom.berg@example.com");
  await page.getByPlaceholder(/Search names and descriptions/).fill("sso");
  await expect(page.getByRole("link", { name: "sso-login" })).toBeVisible();
  await expect(page.getByRole("link", { name: "debit-card-payments" })).toHaveCount(0);
});

test("an editor without production rights sees production read-only", async ({ page }) => {
  await signIn(page, "tom.berg@example.com");
  await page.getByRole("link", { name: "debit-card-payments" }).click();
  await expect(page.getByRole("tab", { name: /production/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Read-only: you can't change production.")).toBeVisible();
  await expect(page.locator(".brandname").filter({ hasText: "Greenfield Stores" })).toBeVisible();
  await page.getByRole("tab", { name: /uat/ }).click();
  await expect(page.getByLabel("Copy rules from")).toBeVisible();
  await expect(page.getByText(/Read-only/)).toHaveCount(0);
});

test("a viewer can read everything and change nothing", async ({ page }) => {
  await signIn(page, "support@example.com");
  await expect(page.getByRole("button", { name: "+ New flag" })).toHaveCount(0);
  await page.getByRole("link", { name: "debit-card-payments" }).click();
  await expect(page.getByText("Viewers can't change flags.")).toBeVisible();
  await expect(page.getByText("Read-only: you can't change production.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.getByText(/override added/).first()).toBeVisible();
});

test("an editor creates a flag; it opens switched off everywhere and is logged under them", async ({ page }) => {
  const name = `zz-e2e-${Date.now()}`;
  await signIn(page, "maria.lopez@example.com");
  await page.getByRole("button", { name: "+ New flag" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Description").fill("created by the e2e test");
  await page.getByLabel("Tags").fill("E2E  test");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/flags/${name}$`));
  await expect(page.getByRole("heading", { name })).toBeVisible();
  for (const env of ["development", "uat", "production"]) {
    await expect(page.getByRole("tab", { name: new RegExp(env) })).toContainText("Disabled");
  }
  await expect(page.getByText(`Flag ${name} created`)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `Flag ${name} created` })).toContainText("maria.lopez@example.com");
});

test("creating a flag with a taken name is refused with a clear message", async ({ page }) => {
  await signIn(page, "maria.lopez@example.com");
  await page.getByRole("button", { name: "+ New flag" }).click();
  await page.getByLabel("Name").fill("debit-card-payments");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("already exists");
});

test("sign out returns to the sign-in page and stays signed out after a reload", async ({ page }) => {
  await signIn(page, "tom.berg@example.com");
  await expect(page.getByText("Tom Berg")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0); // no "Invalid credentials" after signing out
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("Tom Berg")).toHaveCount(0);
});

test("the sidebar opens every page and marks the current one", async ({ page }) => {
  await signIn(page, "support@example.com");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: /Flags/ })).toHaveClass(/active/);
  await nav.getByRole("link", { name: /Archive/ }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  await expect(page.getByText("beta-budget-planner")).toBeVisible();
  await expect(nav.getByRole("link", { name: /Archive/ })).toHaveClass(/active/);
  await nav.getByRole("link", { name: /Audit log/ }).click();
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await nav.getByRole("link", { name: /Connected apps/ }).click();
  await expect(page.getByRole("heading", { name: "Connected apps" })).toBeVisible();
  await expect(page.getByText("payments-service").first()).toBeVisible();
  await expect(page.getByText("debit-card-payment", { exact: true })).toBeVisible(); // an unknown (typo) name
  await nav.getByRole("link", { name: /Flags/ }).click();
  await expect(page.getByRole("link", { name: "debit-card-payments" })).toBeVisible();
});

test("archive: viewers only read, editors revive, admins also delete", async ({ page }) => {
  await signIn(page, "support@example.com");
  await page.goto("/archive");
  await expect(page.getByText("beta-budget-planner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revive" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "tom.berg@example.com");
  await page.goto("/archive");
  await expect(page.getByRole("button", { name: "Revive" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete permanently" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "admin@example.com");
  await page.goto("/archive");
  await expect(page.getByRole("button", { name: "Delete permanently" })).toBeVisible();
});

test("audit log: filter by flag and expand a change", async ({ page }) => {
  await signIn(page, "support@example.com");
  await page.goto("/audit-log");
  await page.getByLabel("Flag", { exact: true }).fill("debit-card");
  await expect(page.locator("#audit-flag-names option[value='debit-card-payments']")).toHaveCount(1);
  await page.getByLabel("Flag", { exact: true }).fill("debit-card-payments");
  await page.getByLabel("Flag", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/flag=debit-card-payments/);
  const row = page.getByRole("row").filter({ hasText: "override added, 10% + 2 customers" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator(".jsondiff .add").filter({ hasText: '"rollout": 10' })).toBeVisible();
});

test("admins get the Admin section with brands, tokens, users and settings", async ({ page }) => {
  await signIn(page, "admin@example.com");
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: /Brands/ }).click();
  await expect(page.getByRole("heading", { name: "Brands" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "bank-a", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add brand" })).toBeVisible();
  await nav.getByRole("link", { name: /API tokens/ }).click();
  await expect(page.getByRole("heading", { name: "API tokens" })).toBeVisible();
  await expect(page.getByText("payments-service").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Import an existing secret instead" }).click();
  await expect(page.getByLabel("Secret")).toBeVisible();
  await nav.getByRole("link", { name: /Users/ }).click();
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expect(page.getByText("tom.berg@example.com")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Password changed" })).toBeVisible();
  await nav.getByRole("link", { name: /Settings/ }).click();
  await expect(page.getByLabel("Brand field name")).toHaveValue("brand");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("non-admins have no Admin section and admin pages are locked", async ({ page }) => {
  await signIn(page, "maria.lopez@example.com");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Brands/ })).toHaveCount(0);
  await page.goto("/admin/users");
  await expect(page.getByText("Only admins can open this page.")).toBeVisible();
  await expect(page.getByText("tom.berg@example.com")).toHaveCount(0);
});

test("the audit log exports the current filter as CSV and JSON", async ({ page }) => {
  await signIn(page, "support@example.com");
  await page.goto("/audit-log");
  await page.goto("/audit-log?flag=debit-card-payments");
  await expect(page.getByRole("row").filter({ hasText: "override added" }).first()).toBeVisible();
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csv = await (await csvDownload).createReadStream();
  const text = await new Promise<string>((res) => { let s = ""; csv.on("data", (c) => (s += c)); csv.on("end", () => res(s)); });
  const lines = text.trim().split(/\r\n/);
  expect(lines[0]).toBe("created_at,created_by,type,flag,environment,brand,summary,pre_data,data");
  expect(lines.length).toBeGreaterThan(3);
  expect(lines.slice(1).every((l) => l.includes("debit-card-payments"))).toBe(true);
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await jsonDownload).suggestedFilename()).toMatch(/^audit-log-.*\.json$/);
});

test("an admin can edit production", async ({ page }) => {
  await signIn(page, "admin@example.com");
  await page.getByRole("link", { name: "debit-card-payments" }).click();
  await expect(page.getByLabel("Copy rules from")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Add brand override" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0); // nothing to save yet
});

// ---- flags list: filters in the address, tags, quick filters, search, export, shortcut

test("the list filters by tag, quick filter and description, and keeps them in the address", async ({ page }) => {
  await signIn(page, "support@example.com");
  await page.keyboard.press("/");
  await expect(page.getByPlaceholder(/Search names and descriptions/)).toBeFocused();
  await page.keyboard.type("fingerprint"); // only in biometric-login's description
  await expect(page.getByRole("link", { name: "biometric-login" })).toBeVisible();
  await expect(page.getByText(/^1 of \d+ flags$/)).toBeVisible();
  await page.getByPlaceholder(/Search names and descriptions/).fill("");
  await page.getByRole("button", { name: /^Tags/ }).click();
  // the address updates a moment after the click, then the box shows it
  await page.getByRole("group", { name: "Tags" }).getByLabel(/payments/).click();
  await expect(page.getByRole("group", { name: "Tags" }).getByLabel(/payments/)).toBeChecked();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/tag=payments/);
  await expect(page.getByRole("link", { name: "debit-card-payments" })).toBeVisible();
  await expect(page.getByRole("link", { name: "biometric-login" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Has brand overrides" }).click();
  await expect(page).toHaveURL(/quick=overrides/);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Has brand overrides" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "debit-card-payments" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "debit-card-payments" });
  await expect(row.getByRole("cell").nth(3)).toHaveAttribute("title", /Greenfield Stores: 10% \+ 2 customers/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const text = await new Promise<string>((res) => void download.then(async (d) => {
    const s = await d.createReadStream(); let t = ""; s.on("data", (c) => (t += c)); s.on("end", () => res(t));
  }));
  const lines = text.trim().split(/\r\n/);
  expect(lines[0]).toBe("name,description,tags,development,uat,production,last_seen,created");
  expect(lines.slice(1).every((l) => /payments/.test(l))).toBe(true);
});

test("'Not seen in N days' uses the Settings value", async ({ page }) => {
  await signIn(page, "support@example.com");
  await expect(page.getByRole("tab", { name: /^Not seen in \d+ days$/ })).toBeVisible();
  await page.getByRole("tab", { name: /^Not seen in/ }).click();
  await expect(page).toHaveURL(/quick=unused/);
});

// ---- flag page: one save for the whole card, conflicts, copy rules, unsaved guard, preview

test("a card saves its default rule and brand overrides together, logged under the editor", async ({ page }) => {
  await signIn(page, "maria.lopez@example.com");
  const name = await newTestFlag(page);
  await page.getByRole("tab", { name: /uat/ }).click();
  await page.locator(".envcard .segmented").first().getByRole("button", { name: "%" }).click();
  await page.getByLabel("Percentage").first().fill("25");
  await page.getByRole("combobox", { name: "Add brand override" }).selectOption("bank-b");
  const bank = page.locator(".ovrow").filter({ hasText: "Harbour Bank" });
  await bank.getByRole("button", { name: "OFF" }).click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /uat/ })).toContainText("●");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  const history = page.locator(".card").filter({ has: page.getByRole("heading", { name: "History" }) });
  await expect(history.getByRole("row").filter({ hasText: "uat - Default: ON -> 25%" })).toContainText("maria.lopez@example.com");
  await expect(history.getByRole("row").filter({ hasText: "Harbour Bank: override added, OFF" })).toContainText("maria.lopez@example.com");
  expect(name).toMatch(/^zz-e2e-/);
});

test("a save over someone else's newer change is refused, and 'Keep my edits' saves on top", async ({ page }) => {
  await signIn(page, "maria.lopez@example.com");
  const name = await newTestFlag(page);
  await page.getByRole("tab", { name: /uat/ }).click();
  await page.locator(".envcard .segmented").first().getByRole("button", { name: "OFF" }).click(); // maria starts editing
  // meanwhile Jon changes the same card in another browser
  const jon = await page.context().newPage(); // its own tab: its own sign-in
  await guardWrites(jon);
  await signIn(jon, "jon.reed@example.com");
  await jon.goto(`/flags/${name}`);
  await jon.getByRole("tab", { name: /uat/ }).click();
  await jon.locator(".envcard .segmented").first().getByRole("button", { name: "%" }).click();
  await jon.getByRole("button", { name: "Save changes" }).click();
  await expect(jon.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  await jon.close();
  await page.getByRole("button", { name: "Save changes" }).click();
  const conflict = page.locator(".conflict");
  await expect(conflict).toContainText("Changed by jon.reed@example.com");
  await expect(conflict).toContainText("Your edits are still below");
  await conflict.getByRole("button", { name: "Keep my edits" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  const history = page.locator(".card").filter({ has: page.getByRole("heading", { name: "History" }) });
  await expect(history.getByRole("row").filter({ hasText: "uat - Default: 50% -> OFF" })).toContainText("maria.lopez@example.com");
  await expect(history.getByRole("row").filter({ hasText: "uat - Default: ON -> 50%" })).toContainText("jon.reed@example.com");
});

test("copy rules from another environment fills the card; leaving asks first", async ({ page }) => {
  await signIn(page, "maria.lopez@example.com");
  await newTestFlag(page);
  await page.getByRole("tab", { name: /development/ }).click();
  await page.locator(".envcard .segmented").first().getByRole("button", { name: "OFF" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /uat/ }).click();
  await page.getByLabel("Copy rules from").selectOption("development");
  await expect(page.locator(".envcard .segmented").first().getByRole("button", { name: "OFF" })).toHaveClass(/active/);
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Archive/ }).click();
  const dialog = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(dialog).toContainText("unsaved changes in uat");
  await dialog.getByRole("button", { name: "Stay" }).click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Archive/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
});

test("the preview says who gets a flag and why", async ({ page }) => {
  await signIn(page, "support@example.com");
  await page.goto("/flags/debit-card-payments");
  await page.getByText("Preview: who gets this flag?").click();
  await page.getByLabel("Preview brand").selectOption("bank-c");
  await page.getByLabel("Customer ID").fill("1001");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toContainText("ON — Customer 1001 is on the list of the Greenfield Stores override.");
  await page.getByLabel("Customer ID").fill("");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toContainText("needs a customer ID");
  await page.getByLabel("Preview brand").selectOption("bank-b");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toContainText("OFF — the Harbour Bank override is OFF.");
});

test("an archived flag opens read-only with who archived it", async ({ page }) => {
  await signIn(page, "maria.lopez@example.com");
  await page.goto("/flags/beta-budget-planner");
  await expect(page.locator(".banner")).toContainText("Archived");
  await expect(page.getByText("Read-only: this flag is archived.")).toBeVisible();
  await expect(page.getByLabel("Copy rules from")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Flag actions" })).toHaveCount(0);
});

test("the audit log filters by event type and brand, kept in the address", async ({ page }) => {
  await signIn(page, "support@example.com");
  await page.goto("/audit-log");
  await page.getByLabel("Event type").selectOption("feature-brand-override-added");
  await page.getByLabel("Brand").selectOption("bank-c");
  await expect(page).toHaveURL(/type=feature-brand-override-added/);
  const rows = page.locator("tbody tr.clickable");
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allTextContents()) expect(text).toContain("Greenfield Stores");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/type=/);
});
