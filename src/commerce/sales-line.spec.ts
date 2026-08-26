import { Product } from '../product/entities/product.entity';
import { TraceabilityLevel } from '../product/traceability-level.enum';
import { billedSalesQuantity, requestedProductUnits } from './sales-line';

function product(partial: Partial<Product>): Product {
  return {
    id: 1,
    name: 'Water',
    baseUnit: 'BOTTLE',
    packUnit: 'CARTON',
    unitsPerPack: 24,
    traceabilityLevel: TraceabilityLevel.SERIAL,
    ...partial,
  } as Product;
}

describe('requestedProductUnits', () => {
  it('converts pack orders to product units', () => {
    expect(requestedProductUnits(product({}), 'CARTON', 84)).toBe(2016);
  });

  it('treats the base unit as 1:1', () => {
    expect(requestedProductUnits(product({}), 'BOTTLE', 2000)).toBe(2000);
  });

  it('uses bare quantity when no units are declared', () => {
    expect(
      requestedProductUnits(
        product({ baseUnit: null, packUnit: null, unitsPerPack: null }),
        null,
        10,
      ),
    ).toBe(10);
  });
});

describe('billedSalesQuantity', () => {
  it('converts fulfilment product units back to cartons', () => {
    expect(billedSalesQuantity(product({}), 'CARTON', 2016)).toBe(84);
  });

  it('bills bottles 1:1', () => {
    expect(billedSalesQuantity(product({}), 'BOTTLE', 2016)).toBe(2016);
  });
});
