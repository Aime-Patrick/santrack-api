import { Product } from '../product/entities/product.entity';
import {
  sellableUnits,
  unitsPerSalesUnit,
} from '../product/sales-unit';

/**
 * Product units implied by a commercial line (DR-09).
 *
 * Legacy lines (null sales unit, no units on the product) treat the requested
 * figure as product units 1:1.
 */
export function requestedProductUnits(
  product: Product,
  salesUnit: string | null | undefined,
  requestedQuantity: number,
): number {
  const offered = sellableUnits(product);
  if (offered.length === 0 || !salesUnit?.trim()) {
    return requestedQuantity;
  }
  return requestedQuantity * unitsPerSalesUnit(product, salesUnit);
}

/**
 * How many sales units to bill for a fulfilment measured in product units.
 * Unit price stays per sales unit.
 */
export function billedSalesQuantity(
  product: Product,
  salesUnit: string | null | undefined,
  fulfilmentProductUnits: number,
): number {
  const offered = sellableUnits(product);
  if (offered.length === 0 || !salesUnit?.trim()) {
    return fulfilmentProductUnits;
  }
  const factor = unitsPerSalesUnit(product, salesUnit);
  return fulfilmentProductUnits / factor;
}
