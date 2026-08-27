/**
 * Copies non-TS assets that `tsc` does not emit (email Handlebars templates).
 * Used by `build:render` on low-memory hosts where `nest build` OOMs.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src', 'email', 'templates');
const to = join(root, 'dist', 'email', 'templates');

if (!existsSync(from)) {
  console.error(`Missing email templates at ${from}`);
  process.exit(1);
}

mkdirSync(dirname(to), { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`Copied email templates → ${to}`);
