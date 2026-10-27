import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const ENVIRONMENTS = ['development', 'uat', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export type BrandSource =
  | { type: 'sqlite'; path: string }
  | { type: 'surreal'; url: string; ns: string; db: string; user: string; pass: string }
  | { type: 'static'; brands: { key: string; displayName?: string }[] };

export interface EnvTokens {
  backend?: string;
  frontend?: string;
}

export interface Target {
  name: string;
  baseUrl: string;
  tokens: Partial<Record<Environment, EnvTokens>>;
  brands: BrandSource;
  contextFields: { brand: string; customer: string };
}

export interface BenchConfig {
  port: number;
  targets: Target[];
}

export class ConfigError extends Error {}

function fail(msg: string): never {
  throw new ConfigError(msg);
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(`${where} must be a non-empty string`);
  return v;
}

function parseBrandSource(raw: any, where: string, baseDir: string): BrandSource {
  if (!raw || typeof raw !== 'object') fail(`${where} is required`);
  switch (raw.type) {
    case 'sqlite':
      return { type: 'sqlite', path: resolve(baseDir, str(raw.path, `${where}.path`)) };
    case 'surreal':
      return {
        type: 'surreal',
        url: str(raw.url, `${where}.url`).replace(/\/+$/, ''),
        ns: str(raw.ns, `${where}.ns`),
        db: str(raw.db, `${where}.db`),
        user: str(raw.user, `${where}.user`),
        pass: str(raw.pass, `${where}.pass`),
      };
    case 'static':
      if (!Array.isArray(raw.brands)) fail(`${where}.brands must be an array`);
      return {
        type: 'static',
        brands: raw.brands.map((b: any, i: number) => ({
          key: str(b?.key, `${where}.brands[${i}].key`),
          displayName: typeof b?.displayName === 'string' ? b.displayName : undefined,
        })),
      };
    default:
      fail(`${where}.type must be one of sqlite, surreal, static`);
  }
}

export function parseConfig(raw: any, baseDir: string): BenchConfig {
  if (!raw || typeof raw !== 'object') fail('config must be a JSON object');
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) fail('targets must be a non-empty array');
  const names = new Set<string>();
  const targets = raw.targets.map((t: any, i: number): Target => {
    const where = `targets[${i}]`;
    const name = str(t?.name, `${where}.name`);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) fail(`${where}.name may only contain letters, digits, . _ -`);
    if (names.has(name)) fail(`duplicate target name "${name}"`);
    names.add(name);
    const tokens: Target['tokens'] = {};
    for (const [env, v] of Object.entries(t.tokens ?? {})) {
      if (!(ENVIRONMENTS as readonly string[]).includes(env)) fail(`${where}.tokens.${env}: unknown environment`);
      const e = v as any;
      tokens[env as Environment] = {
        backend: typeof e?.backend === 'string' && e.backend ? e.backend : undefined,
        frontend: typeof e?.frontend === 'string' && e.frontend ? e.frontend : undefined,
      };
    }
    return {
      name,
      baseUrl: str(t.baseUrl, `${where}.baseUrl`).replace(/\/+$/, ''),
      tokens,
      brands: parseBrandSource(t.brands, `${where}.brands`, baseDir),
      contextFields: {
        brand: typeof t.contextFields?.brand === 'string' ? t.contextFields.brand : 'brand',
        customer: typeof t.contextFields?.customer === 'string' ? t.contextFields.customer : 'userId',
      },
    };
  });
  const port = raw.port === undefined ? 4300 : Number(raw.port);
  if (!Number.isInteger(port) || port < 0) fail('port must be a non-negative integer (0 = any free port)');
  return { port, targets };
}

export function loadConfig(path: string): BenchConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    fail(`cannot read ${path} — copy testbench.config.example.json to testbench.config.json and edit it`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    fail(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  const cfg = parseConfig(raw, dirname(resolve(path)));
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  // A deployed bench keeps its SDK tokens out of the config file (and the image):
  // TESTBENCH_TOKENS = {"<target>": {"<environment>": {"backend": "…", "frontend": "…"}}}.
  if (process.env.TESTBENCH_TOKENS) {
    let byTarget: any;
    try {
      byTarget = JSON.parse(process.env.TESTBENCH_TOKENS);
    } catch (e) {
      fail(`TESTBENCH_TOKENS is not valid JSON: ${(e as Error).message}`);
    }
    for (const [name, tokens] of Object.entries(byTarget ?? {})) {
      const target = cfg.targets.find((t) => t.name === name) ?? fail(`TESTBENCH_TOKENS names unknown target "${name}"`);
      target.tokens = parseConfig(
        { targets: [{ name, baseUrl: target.baseUrl, brands: { type: 'static', brands: [] }, tokens }] },
        '.',
      ).targets[0]!.tokens;
    }
  }
  return cfg;
}
