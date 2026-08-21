// Promotes an existing user to SYSTEM_ADMIN.
//
// This is deliberately not an API endpoint. SYSTEM_ADMIN is the only role that
// can confer regulatory standing, and regulatory standing means reading every
// organization's chain of custody - so the first holder cannot be granted
// through the platform, or the platform would be granting its own trust.
// Someone with database access does it once, out of band.
//
//     node scripts/grant-system-admin.mjs person@example.com
import { config } from 'dotenv';
import pg from 'pg';

config();

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error('Usage: node scripts/grant-system-admin.mjs <email>');
  process.exit(1);
}

const client = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5433', 10),
  database: process.env.DB_NAME ?? 'santrack',
  user: process.env.DB_USER ?? 'stock',
  password: process.env.DB_PASSWORD ?? 'stock_dev',
});

try {
  await client.connect();
} catch (error) {
  console.error(`Cannot reach the database: ${error.message}`);
  process.exit(1);
}

const { rows } = await client.query(
  `UPDATE users SET role = 'SYSTEM_ADMIN'
    WHERE lower(email) = $1
    RETURNING id, email, role`,
  [email],
);

if (rows.length === 0) {
  console.error(`No account found for ${email}. Register it first, then re-run.`);
  await client.end();
  process.exit(1);
}

console.log(`${rows[0].email} (id ${rows[0].id}) is now ${rows[0].role}.`);
console.log(
  'They can now grant regulatory standing:\n' +
    '  PUT /api/organizations/:id/regulatory-standing  {"type":"REGULATOR"}',
);

await client.end();
