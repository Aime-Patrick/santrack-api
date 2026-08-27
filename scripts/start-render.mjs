/**
 * Render start wrapper (free tier has no pre-deploy).
 * 1. Apply migrations
 * 2. Optionally seed demo data when SEED_ON_START=true
 * 3. Start the API
 */
import { spawnSync } from 'node:child_process';

function run(label, command, args) {
  console.log(`\n→ ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(
  'Running migrations',
  process.execPath,
  ['./node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/config/data-source.js'],
);

if (process.env.SEED_ON_START === 'true') {
  run('Seeding demo data', process.execPath, ['dist/seed.js']);
}

run('Starting API', process.execPath, ['dist/main.js']);
