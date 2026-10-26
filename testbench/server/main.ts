import { join } from 'node:path';
import { createBenchApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';

const configPath = process.env.TESTBENCH_CONFIG ?? 'testbench.config.json';

let config;
try {
  config = loadConfig(configPath);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`Config error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

const app = createBenchApp(config, { staticDir: join(import.meta.dirname, '..', 'dist') });
const port = await app.listen(config.port);
console.log(`\nTest bench running at http://localhost:${port}`);
for (const t of config.targets) console.log(`  target ${t.name} → ${t.baseUrl} (brands: ${t.brands.type})`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
