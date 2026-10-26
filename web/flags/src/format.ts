/** "3 min ago", "2 d ago" for an RFC 3339 text; "" for empty or unparseable. */
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.round(d / 365)} y ago`;
}

/** CSS class for a rule / environment summary: ON, OFF, 25%, Only 3 customers, Disabled. */
export function ruleClass(label: string | null | undefined): string {
  if (!label) return "";
  if (label.startsWith("Disabled")) return "rule-disabled";
  if (label.startsWith("ON")) return "rule-on";
  if (label.startsWith("OFF")) return "rule-off";
  if (label.startsWith("Only")) return "rule-only";
  return "rule-partial";
}

export const ENVIRONMENTS = ["development", "uat", "production"] as const;
export type Env = (typeof ENVIRONMENTS)[number];

/** The sentence a database rule THROWs, without the driver's wrapping ("…An error occurred: <text>"). */
export function friendlyError(message: string): string {
  const thrown = message.match(/An error occurred: ([^"]+)/);
  if (thrown?.[1]) return thrown[1].trim();
  const field = message.match(/for field `(\w+)`/);
  if (field?.[1]) return `The value for "${field[1].replace(/_/g, " ")}" isn't allowed.`;
  return message;
}

/** `n` random bytes as lowercase hex, from the browser's cryptographic generator. */
export function randomHex(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** A temporary password: 16 characters without look-alikes (0/O, 1/l/I). */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
}

/** Save `text` as a file the browser downloads. */
export function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    // A cell starting with = + - @ (or tab/CR) would run as a formula in a spreadsheet.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

/** "2026-10-17T143005" for file names. */
export const fileStamp = () => new Date().toISOString().slice(0, 19).replace(/:/g, "");

/** Pretty-printed JSON text, or "" for empty / unparseable input. */
export function prettyJson(json: string | null | undefined): string {
  if (!json) return "";
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export type DiffLine = { kind: " " | "-" | "+"; text: string };

/** Line diff of two texts (longest common subsequence): unchanged, removed and added lines. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  const n = a.length, m = b.length;
  // lcs(i, j): length of the longest common run of a[i..] and b[j..], in one flat array
  const lcs = new Array<number>((n + 1) * (m + 1)).fill(0);
  const at = (i: number, j: number) => lcs[i * (m + 1) + j] ?? 0;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i * (m + 1) + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: " ", text: a[i] ?? "" }); i++; j++; }
    else if (at(i + 1, j) >= at(i, j + 1)) out.push({ kind: "-", text: a[i++] ?? "" });
    else out.push({ kind: "+", text: b[j++] ?? "" });
  }
  while (i < n) out.push({ kind: "-", text: a[i++] ?? "" });
  while (j < m) out.push({ kind: "+", text: b[j++] ?? "" });
  return out;
}

/** Customer IDs in an allowlist text, as the database splits them (commas, semicolons, whitespace). */
export const listItems = (s: string | null | undefined) => Array.from(new Set((s ?? "").split(/[\s,;]+/).filter(Boolean)));

/** Problems with an allowlist, worded like the database rules (spec 02: ≤1000 IDs of ≤100 characters). */
export function allowlistProblems(s: string): string[] {
  const ids = listItems(s);
  const out: string[] = [];
  if (ids.length > 1000) out.push(`${ids.length} customers - at most 1000 per rule`);
  const long = ids.find((id) => id.length > 100);
  if (long) out.push(`customer ID "${long.slice(0, 20)}…" is longer than 100 characters`);
  return out;
}
