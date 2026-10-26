// Imports a fixed set of test-bench tokens (backend + frontend per environment) into a target that
// implements the spec's management API (spec/06: /mgmt/v1/auth/login, /mgmt/v1/tokens/import).
// The token secrets are printed as a ready-to-paste `tokens` block for testbench.config.json.
//
// usage: node scripts/import-tokens.ts <baseUrl> [email] [password]

const [baseUrl, email = 'admin@example.com', password = 'change-me-please'] = process.argv.slice(2);
if (!baseUrl) {
  console.error('usage: node scripts/import-tokens.ts <baseUrl> [email] [password]');
  process.exit(2);
}
const base = baseUrl.replace(/\/+$/, '');
const ENVS = ['development', 'uat', 'production'];

const login = await fetch(`${base}/mgmt/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.error(`login failed: HTTP ${login.status} ${await login.text()}`);
  process.exit(1);
}
const { csrfToken } = (await login.json()) as { csrfToken: string };
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

const tokens: Record<string, Record<string, string>> = {};
for (const env of ENVS) {
  tokens[env] = {};
  for (const type of ['backend', 'frontend']) {
    const secret = `default:${env}.testbench${type}${'0'.repeat(56 - 9 - type.length)}`;
    const res = await fetch(`${base}/mgmt/v1/tokens/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ name: `testbench ${type} ${env}`, type, environment: env, secret }),
    });
    const note = res.ok ? 'imported' : res.status === 409 ? 'already present' : `FAILED HTTP ${res.status} ${await res.text()}`;
    console.error(`${env.padEnd(12)} ${type.padEnd(9)} ${note}`);
    tokens[env][type] = secret;
  }
}
console.log(JSON.stringify({ tokens }, null, 2));
