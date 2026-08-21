// Creates the SANTRACK database inside the existing Postgres instance.
//
// The shared docker-compose Postgres was initialised with stock_manager for the
// old Java service, and POSTGRES_DB only takes effect on an empty volume - so
// the new database is created here instead of by changing that file.
//
//     node scripts/setup-db.mjs
import { config } from 'dotenv';
import pg from 'pg';

config();

const target = process.env.DB_NAME ?? 'santrack';

const admin = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5433', 10),
  // Connect to the maintenance database; CREATE DATABASE cannot run inside
  // the database it is creating.
  database: 'postgres',
  user: process.env.DB_USER ?? 'stock',
  password: process.env.DB_PASSWORD ?? 'stock_dev',
});

try {
  await admin.connect();
} catch (error) {
  console.error(`Cannot reach Postgres: ${error.message}`);
  console.error('Start it with:  docker compose up -d   (from the repo root)');
  process.exit(1);
}

const { rowCount } = await admin.query(
  'SELECT 1 FROM pg_database WHERE datname = $1',
  [target],
);

if (rowCount > 0) {
  console.log(`Database "${target}" already exists.`);
} else {
  await admin.query(`CREATE DATABASE "${target}"`);
  console.log(`Created database "${target}".`);
}

await admin.end();
console.log('Next:  pnpm migration:run');
