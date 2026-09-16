/**
 * Low-memory production emit for Render free tier.
 *
 * Full-project tsc / nest build peak above ~450MB and OOM on the free plan.
 * This walks every .ts file under src (excluding specs) and emits one file at
 * a time via ts.transpileModule, then copies email templates.
 *
 * No typecheck — run `pnpm typecheck` locally/CI. Nest/TypeORM still get
 * legacy decorators + emitDecoratorMetadata.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'src');
const distRoot = join(root, 'dist');

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  importHelpers: false,
  sourceMap: false,
  inlineSources: false,
  removeComments: true,
  strict: false,
};

function listTsFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (!name.endsWith('.ts')) continue;
    if (name.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

function emitFile(absPath) {
  const source = readFileSync(absPath, 'utf8');
  const rel = relative(srcRoot, absPath).replace(/\\/g, '/');
  const result = ts.transpileModule(source, {
    compilerOptions,
    fileName: absPath,
    reportDiagnostics: true,
  });

  const fatal = (result.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (fatal.length > 0) {
    for (const d of fatal) {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      console.error(`${rel}: ${msg}`);
    }
    process.exit(1);
  }

  const outRel = rel.replace(/\.ts$/, '.js');
  const outPath = join(distRoot, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.outputText, 'utf8');
}

if (existsSync(distRoot)) {
  rmSync(distRoot, { recursive: true, force: true });
}
mkdirSync(distRoot, { recursive: true });

const files = listTsFiles(srcRoot);
console.log(`Transpiling ${files.length} TypeScript files (low-memory)…`);
for (const file of files) {
  emitFile(file);
}

const templatesFrom = join(srcRoot, 'email', 'templates');
const templatesTo = join(distRoot, 'email', 'templates');
if (!existsSync(templatesFrom)) {
  console.error(`Missing email templates at ${templatesFrom}`);
  process.exit(1);
}
mkdirSync(dirname(templatesTo), { recursive: true });
cpSync(templatesFrom, templatesTo, { recursive: true });
console.log(`Copied email templates → ${templatesTo}`);
console.log('build:render complete');
