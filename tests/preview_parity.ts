// tests/preview_parity.ts [service-url] - the web flag page's preview (web/flags/src/preview.ts)
// gives the same answers as the SDK service (Unleash's own engine) for production: every brand
// (plus none) x 200 customers + every allowlisted customer + no customer, for every flag that
// has a brand override. Run with Node 25+: `node tests/preview_parity.ts`.
// It adds a throwaway frontend token for production and revokes it at the end.
import { execFileSync } from "node:child_process";
import { isEnabled, type Feature } from "../web/flags/src/preview.ts";

const SERVICE = process.argv[2] ?? "http://127.0.0.1:4380";
const SECRET = "default:production.preview-parity-" + Date.now().toString(16).padStart(24, "0");
const surql = (q: string): unknown[] => {
  const out = execFileSync("tests/surql.sh", ["-", "-f"], { input: q, encoding: "utf8" });
  return out.trim().split("\n").map((l) => JSON.parse(l.replace(/^#\d+ OK\s+/, "")));
};

surql(`CREATE api_token SET name = 'preview parity (test)', type = 'frontend', environment = 'production', new_secret = '${SECRET}', created_by = 'preview_parity' RETURN NONE;`);
let failures = 0, checked = 0;
try {
  await new Promise((r) => setTimeout(r, 3000)); // the service may cache "unknown token" for a few seconds
  const [settings] = surql("SELECT VALUE [brand_context_field, customer_context_field] FROM ONLY settings:main;") as [string[]];
  const [brandField, customerField] = settings as [string, string];
  const [rows] = surql(`SELECT VALUE encoding::json::encode(fn::compile(id)) FROM flag_env
    WHERE env_key = 'production' AND flag.archived != true AND flag.override_count > 0;`) as [string[]];
  const features = rows.map((r) => JSON.parse(r) as Feature);
  const brands = ["", ...(surql("SELECT VALUE key FROM brand;")[0] as string[]), "unknown-brand"];
  const listed = new Set<string>();
  for (const f of features) for (const s of f.strategies) for (const c of s.constraints ?? []) if (c.contextName === customerField) c.values.forEach((v) => listed.add(v));
  const customers = ["", ...listed, ...Array.from({ length: 200 }, (_, i) => String(1000 + i * 37))];

  for (const brand of brands) {
    for (const customer of customers) {
      const properties: Record<string, string> = {};
      if (brand) properties[brandField] = brand;
      if (customer && customerField !== "userId") properties[customerField] = customer;
      const userId = customerField === "userId" && customer ? customer : undefined;
      // a fixed sessionId keeps "default" stickiness out of the random path on both sides
      const res = await fetch(`${SERVICE}/api/frontend`, {
        method: "POST",
        headers: { Authorization: SECRET, "Content-Type": "application/json" },
        body: JSON.stringify({ context: { ...(userId && { userId }), sessionId: "parity", properties } }),
      });
      if (!res.ok) throw new Error(`service answered ${res.status}: ${await res.text()}`);
      const on = new Set(((await res.json()) as { toggles: { name: string }[] }).toggles.map((t) => t.name));
      for (const f of features) {
        checked++;
        const mine = isEnabled(f, { userId, sessionId: "parity", properties });
        if (mine !== on.has(f.name)) {
          failures++;
          if (failures <= 10) console.log(`DIFF ${f.name} brand=${brand || "-"} customer=${customer || "-"}: preview ${mine}, service ${on.has(f.name)}`);
        }
      }
    }
  }
  console.log(`${features.length} flags x ${brands.length} brands x ${customers.length} customers: ${checked} answers, ${failures} differences`);
} finally {
  surql(`DELETE api_token WHERE created_by = 'preview_parity';`);
}
process.exitCode = failures ? 1 : 0;
