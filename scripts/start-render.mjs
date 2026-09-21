/**
 * Render start wrapper (free tier has no pre-deploy).
 * 1. Apply migrations
 * 2. Optionally seed demo data when explicitly allowed
 * 3. Start the API
 *
 * Production never seeds unless ALLOW_DEMO_SEED=true is set together with
 * SEED_ON_START=true. Demo accounts use well-known weak passwords.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let typeormCli;
try {
  typeormCli = require.resolve('typeorm/cli.js');
} catch {
  typeormCli = './node_modules/typeorm/cli.js';
}

function run(label, command, args) {
  console.log(`\n→ ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error(`❌ ${label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

run(
  'Running migrations',
  process.execPath,
  [typeormCli, 'migration:run', '-d', 'dist/config/data-source.js'],
);

const wantsSeed = process.env.SEED_ON_START === 'true';
const isProduction = process.env.NODE_ENV === 'production';
const allowDemoSeed = process.env.ALLOW_DEMO_SEED === 'true';

if (wantsSeed) {
  if (isProduction && !allowDemoSeed) {
    console.error(
      'Refusing SEED_ON_START in production. Demo passwords are public. Set ALLOW_DEMO_SEED=true only for disposable demo environments.',
    );
    process.exit(1);
  }
  run('Seeding demo data', process.execPath, ['dist/seed.js']);
}

console.log('\n→ Starting API');
await import('../dist/main.js');
