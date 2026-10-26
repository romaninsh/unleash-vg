// Headless stress run against one target from testbench.config.json.
//
//   node scripts/stress.ts --target=unleash-vg [--env=production] [--mode=frontend|client|mixed]
//        [--concurrency=32] [--duration=30] [--brand=random|none|<key>] [--customers=1-1000000|uuid]
//        [--check=0.02] [--no-conditional] [--json]
//
// Exit code 1 if any request failed or any sampled answer disagreed with the official SDK.

import { listBrands } from '../server/brands.ts';
import { loadConfig } from '../server/config.ts';
import { SdkPool } from '../server/sdk-pool.ts';
import { StressRun, validateOptions, type StressSnapshot } from '../server/stress.ts';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : 'true'];
  }),
) as Record<string, string>;

const config = loadConfig(process.env.TESTBENCH_CONFIG ?? 'testbench.config.json');
const target = config.targets.find((t) => t.name === args.target);
if (!target) {
  console.error(`--target must be one of: ${config.targets.map((t) => t.name).join(', ')}`);
  process.exit(2);
}

const brandArg = args.brand ?? 'random';
const brands = brandArg === 'random' ? (await listBrands(target.brands)).brands.filter((b) => b.active).map((b) => b.key) : [];
const [cmin, cmax] = (args.customers ?? '1-1000000').split('-').map(Number);

const opts = validateOptions({
  target: target.name,
  environment: args.env ?? 'production',
  mode: (args.mode ?? 'frontend') as any,
  concurrency: Number(args.concurrency ?? 32),
  durationSec: Number(args.duration ?? 30),
  brandMode: brandArg === 'random' ? 'random' : brandArg === 'none' ? 'none' : 'selected',
  selectedBrand: brandArg !== 'random' && brandArg !== 'none' ? brandArg : undefined,
  brands,
  customerMode: args.customers === 'uuid' ? 'uuid' : 'range',
  customerMin: cmin,
  customerMax: cmax,
  conditional: args['no-conditional'] !== 'true',
  checkSample: Number(args.check ?? 0.02),
});

const pool = new SdkPool((t) => `${t.baseUrl}/api/`);
const run = new StressRun(opts, target, pool);
const progress = setInterval(() => {
  const s = run.snapshot();
  if (!args.json) {
    process.stderr.write(
      `\r${s.elapsedSec.toFixed(0).padStart(4)}s  ${String(s.requests).padStart(8)} req  ${String(s.rps).padStart(6)} rps  p95 ${s.latency.p95}ms  errors ${s.errors}   `,
    );
  }
}, 1000);
await run.done;
clearInterval(progress);
pool.destroyAll();

const s: StressSnapshot = run.snapshot();
if (args.json) {
  console.log(JSON.stringify(s, null, 2));
} else {
  process.stderr.write('\n');
  if (s.failure) console.log(`FAILED: ${s.failure}`);
  console.log(`\n${target.name} · ${opts.environment} · ${opts.mode} · ${opts.concurrency} workers · ${s.elapsedSec}s`);
  console.log(`requests ${s.requests}  throughput ${s.rps} req/s  errors ${s.errors}`);
  console.log(`statuses ${Object.entries(s.statuses).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.table(
    Object.fromEntries(
      Object.entries({ all: s.latency, ...s.byEndpoint }).map(([k, l]) => [
        k,
        { count: l.count, 'p50 ms': l.p50, 'p90 ms': l.p90, 'p95 ms': l.p95, 'p99 ms': l.p99, 'max ms': l.max },
      ]),
    ),
  );
  console.log(
    `correctness: ${s.checks.compared} sampled answers compared with the SDK, ${s.checks.mismatches} mismatches` +
      (s.checks.note ? ` (${s.checks.note})` : ''),
  );
  for (const m of s.checks.samples) console.log('  mismatch', JSON.stringify(m));
  for (const e of s.errorSamples) console.log('  error', e);
}
process.exit(s.failure || s.errors > 0 || s.checks.mismatches > 0 ? 1 : 0);
