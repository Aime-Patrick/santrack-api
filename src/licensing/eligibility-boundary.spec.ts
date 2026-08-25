import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * DR §24 invariant 10, as an architecture test that runs in CI.
 *
 * > No class outside `src/licensing/` imports `License`, `LicenseCategory` or
 * > `LicenseStatus` **to reach a production-eligibility verdict**.
 *
 * The qualifier is the invariant's own, and it matters. Three places outside
 * the module already read licence rows and are not reaching an eligibility
 * verdict: the entity registry, the regulator's analytics panel and the CSV
 * export. They are listed below rather than silently permitted, so a *new*
 * reader fails this test and has to justify itself.
 *
 * What must never appear is a second answer to "may this business produce?".
 * `src/manufacturing/` in particular is held to the strict rule: it asks
 * `ProductionEligibilityService`, and it never opens a licence row to work the
 * answer out for itself.
 */
describe('the licensing boundary', () => {
  const SRC = join(__dirname, '..');

  /** Existing readers, none of which reaches an eligibility verdict. */
  const ALLOWED = new Set([
    join('config', 'data-source.ts'), // the entity registry
    join('analytics', 'analytics.module.ts'),
    join('analytics', 'analytics.service.ts'), // regulator dashboard counts
    join('reporting', 'reporting.module.ts'),
    join('reporting', 'reporting.service.ts'), // CSV export of the caller's own licences
    join('traceability', 'controllers', 'trace.controller.ts'),
    'seed.ts',
  ]);

  const IMPORTS_LICENSING =
    /from\s+['"][^'"]*licensing\/(entities\/license\.entity|licensing\.enums)['"]/;

  function walk(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'migrations') {
          continue;
        }
        walk(full, found);
      } else if (entry.endsWith('.ts')) {
        found.push(full);
      }
    }
    return found;
  }

  const outside = walk(SRC).filter(
    (file) => !relative(SRC, file).startsWith(`licensing${sep}`),
  );

  it('finds the source tree it is meant to be checking', () => {
    expect(outside.length).toBeGreaterThan(100);
  });

  it('lets no new module outside src/licensing read a licence row', () => {
    const offenders = outside
      .filter((file) => IMPORTS_LICENSING.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });

  it('keeps manufacturing entirely out of the licence tables', () => {
    // The enforcement hole DR-07 closes is that `ProductionService.create()`
    // had no licensing check at all. The fix is that it asks the eligibility
    // service - not that it learns to read licences itself, which would be a
    // second implementation of the rule and therefore a second answer.
    const manufacturing = outside.filter((file) =>
      relative(SRC, file).startsWith(`manufacturing${sep}`),
    );

    expect(manufacturing.length).toBeGreaterThan(0);
    for (const file of manufacturing) {
      expect(IMPORTS_LICENSING.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });

  it('keeps one implementation of "which licence governs"', () => {
    // T2. Two implementations of this question is how a regulatory verdict
    // becomes non-deterministic, so the resolution rule stays in one file.
    const resolvers = walk(SRC).filter((file) =>
      /facility-scoped licence[\s\S]{0,400}replaces/i.test(readFileSync(file, 'utf8')),
    );

    expect(
      resolvers.map((file) => relative(SRC, file)).filter((file) => !file.endsWith('.spec.ts')),
    ).toEqual([join('licensing', 'governing-licence.ts')]);
  });
});
