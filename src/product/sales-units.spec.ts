import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { TraceabilityRuleException } from '../common/errors';
import { CreateProductDto } from './dto/product.dto';
import { Product } from './entities/product.entity';
import { ProductService } from './services/product.service';

/**
 * The product's unit model (DR-09 WU-2).
 *
 * Three columns and one conversion, deliberately. `base_unit` gives
 * `TraceableItem.quantity` its noun; `pack_unit` and `units_per_pack` are the
 * only conversion the platform knows. None of it is stock truth — a real
 * carton's quantity still comes from its children — so these cases check the
 * shape of the declaration, not anything about stock.
 */

function service(existing?: Partial<Product>) {
  let stored: Record<string, unknown> | null = existing
    ? ({ id: 1, sku: 'YOG-001', ...existing } as Record<string, unknown>)
    : null;

  const products = {
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.id !== undefined ? stored : null),
    ),
    save: jest.fn((row: Record<string, unknown>) => {
      stored = { ...stored, ...row, id: 1 };
      return Promise.resolve(stored);
    }),
    create: jest.fn((row: unknown) => row),
  };

  return new ProductService(
    products as never,
    {} as never,
    { findOne: () => Promise.resolve(null) } as never,
    { findOne: () => Promise.resolve(null) } as never,
  );
}

describe('declaring what a product is sold in', () => {
  it('accepts a base unit with one pack that wraps it', async () => {
    const product = await service().create(1, {
      name: 'Yogurt 500ml',
      baseUnit: 'BOTTLE',
      packUnit: 'CARTON',
      unitsPerPack: 24,
    });

    expect(product.baseUnit).toBe('BOTTLE');
    expect(product.packUnit).toBe('CARTON');
    expect(product.unitsPerPack).toBe(24);
  });

  it('accepts a product that declares nothing at all', async () => {
    // Every one of the 128 products already in the catalogue is this case.
    // Quantities show as bare numbers, exactly as they do today.
    const product = await service().create(1, { name: 'Widget' });

    expect(product.baseUnit).toBeNull();
    expect(product.packUnit).toBeNull();
    expect(product.unitsPerPack).toBeNull();
  });

  it('accepts a base unit with no pack', async () => {
    // Bulk milk: sold by the litre and in nothing else.
    const product = await service().create(1, {
      name: 'Bulk milk',
      baseUnit: 'LITRE',
    });

    expect(product.baseUnit).toBe('LITRE');
    expect(product.packUnit).toBeNull();
  });

  it('refuses a pack with no size', async () => {
    // CARTON of how many? An unanswerable question stored is a conversion
    // waiting to be guessed at.
    await expect(
      service().create(1, {
        name: 'Yogurt',
        baseUnit: 'BOTTLE',
        packUnit: 'CARTON',
      }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('refuses a size with no pack', async () => {
    await expect(
      service().create(1, {
        name: 'Yogurt',
        baseUnit: 'BOTTLE',
        unitsPerPack: 24,
      }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('names the missing half in the refusal', async () => {
    // The person filling in the form has to be told which field to complete.
    await expect(
      service().create(1, { name: 'Yogurt', packUnit: 'CARTON' }),
    ).rejects.toThrow(/CARTON needs a size/);

    await expect(
      service().create(1, { name: 'Yogurt', unitsPerPack: 24 }),
    ).rejects.toThrow(/needs a pack to name/);
  });
});

describe('changing what a product is sold in', () => {
  const packed = {
    name: 'Yogurt 500ml',
    baseUnit: 'BOTTLE',
    packUnit: 'CARTON',
    unitsPerPack: 24,
  };

  it('judges the result of the change, not the fields sent', async () => {
    // Sending only a new pack name to a product that already has a size is a
    // complete definition. Looking at the request alone, it is half of one.
    const product = await service(packed).update(1, 1, {
      name: 'Yogurt 500ml',
      packUnit: 'CRATE',
    });

    expect(product.packUnit).toBe('CRATE');
    expect(product.unitsPerPack).toBe(24);
  });

  it('leaves the declaration alone when the update does not mention it', async () => {
    const product = await service(packed).update(1, 1, { name: 'Yogurt 500ml' });

    expect(product.baseUnit).toBe('BOTTLE');
    expect(product.packUnit).toBe('CARTON');
    expect(product.unitsPerPack).toBe(24);
  });

  it('refuses an update that would leave half a pack behind', async () => {
    // Clearing the pack name while its size stays would leave 24 of nothing.
    await expect(
      service(packed).update(1, 1, { name: 'Yogurt 500ml', packUnit: '' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });
});

describe('the pack size a request may carry', () => {
  const check = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(CreateProductDto, payload));

  it('refuses a pack of one', () => {
    // A pack holding one unit is that unit with a second name, and it would
    // make every order round to itself while looking like a conversion.
    const errors = check({ name: 'Yogurt', packUnit: 'CARTON', unitsPerPack: 1 });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('unitsPerPack');
  });

  it('refuses a fractional pack size', () => {
    // Half a bottle in a carton is not a packing arrangement.
    expect(
      check({ name: 'Yogurt', packUnit: 'CARTON', unitsPerPack: 2.5 }),
    ).toHaveLength(1);
  });

  it('accepts a pack of two or more', () => {
    expect(
      check({ name: 'Yogurt', packUnit: 'PAIR', unitsPerPack: 2 }),
    ).toHaveLength(0);
  });
});
