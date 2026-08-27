import { NotFoundEntityException, TraceabilityRuleException } from '../common/errors';
import { ProductService } from './services/product.service';

/**
 * The taxonomy's job is to stop uncontrolled strings entering the catalogue.
 * These check the boundary where that happens (DR-05).
 */
describe('product category assignment', () => {
  const DAIRY = { id: 1, code: 'DAIRY', name: 'Dairy', active: true };
  const WITHDRAWN = { id: 9, code: 'OLD', name: 'Old scheme', active: false };

  function service() {
    // `create` re-reads the product so the eagerly-loaded category comes back
    // with it, so the stub has to answer both questions the service asks: is
    // this SKU taken, and what does the saved row look like.
    let stored: Record<string, unknown> | null = null;

    const products = {
      findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(where.id !== undefined ? stored : null),
      ),
      save: jest.fn((row: Record<string, unknown>) => {
        stored = { ...row, id: 1 };
        return Promise.resolve(stored);
      }),
      create: jest.fn((row: unknown) => row),
    };
    const categories = {
      findOne: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(
          [DAIRY, WITHDRAWN].find((category) => category.id === where.id) ?? null,
        ),
      ),
    };
    return new ProductService(
      products as never,
      {} as never,
      categories as never,
      // Brands: these cases only exercise the category rules, and a product
      // with no brandId never reaches the repository.
      { findOne: () => Promise.resolve(null) } as never,
    );
  }

  it('files a product under a category from the catalogue', async () => {
    const product = await service().create(1, {
      name: 'Yogurt 500ml',
      categoryId: DAIRY.id,
    });

    expect(product.categoryId).toBe(DAIRY.id);
  });

  it('refuses a product with no category', async () => {
    // Catalogue goods are always filed under a kind. Leaving it blank used to
    // invent an "uncategorised" gap that opening stock and sales then had to
    // paper over.
    await expect(
      service().create(1, { name: 'Widget' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('refuses free text rather than ignoring it', async () => {
    // Silently dropping it would leave the caller believing the product was
    // classified when it was not, which is the failure the taxonomy exists to
    // prevent.
    await expect(
      service().create(1, { name: 'Yogurt', category: 'Dairy' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('refuses a category that does not exist', async () => {
    await expect(
      service().create(1, { name: 'Yogurt', categoryId: 404 }),
    ).rejects.toBeInstanceOf(NotFoundEntityException);
  });

  it('refuses a withdrawn category for new products', async () => {
    // Existing products keep theirs; nothing new joins a retired scheme.
    await expect(
      service().create(1, { name: 'Yogurt', categoryId: WITHDRAWN.id }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('refuses free text on UPDATE as well as on create', async () => {
    // The guard was originally only reached when `categoryId` was present, so
    // an update carrying only `category: "Dairy"` skipped it and was silently
    // accepted — the free-text door left open on the other side of the house.
    const svc = service();
    const created = await svc.create(1, { name: 'Yogurt', categoryId: DAIRY.id });

    await expect(
      svc.update(created.id, 1, { name: 'Yogurt', category: 'Dairy' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('leaves the category alone when an update mentions neither field', async () => {
    const svc = service();
    const created = await svc.create(1, { name: 'Yogurt', categoryId: DAIRY.id });

    const updated = await svc.update(created.id, 1, { name: 'Renamed' });

    expect(updated.categoryId).toBe(DAIRY.id);
  });

  it('never writes the legacy free-text column on new products', async () => {
    const product = await service().create(1, {
      name: 'Yogurt',
      categoryId: DAIRY.id,
    });
    expect(product.category).toBeNull();
  });
});

/**
 * The backfill rule, expressed as the migration applies it. Kept as a unit
 * check so the normalisation is testable without a database.
 */
describe('legacy category normalisation', () => {
  const normalise = (raw: string | null): string | null => {
    const trimmed = (raw ?? '').trim();
    return trimmed === '' ? null : trimmed.toUpperCase();
  };

  it.each([
    ['DAIRY', 'DAIRY'],
    ['Dairy', 'DAIRY'],
    ['dairy', 'DAIRY'],
    ['  Books  ', 'BOOKS'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalise(input)).toBe(expected);
  });

  it('treats an empty string as no category at all', () => {
    // The database held one of these. It never meant a category named "".
    expect(normalise('')).toBeNull();
    expect(normalise('   ')).toBeNull();
    expect(normalise(null)).toBeNull();
  });
});
