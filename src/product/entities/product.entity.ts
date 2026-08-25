import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Symbology } from '../../barcode/symbology';
import { Brand } from './brand.entity';
import { ProductCategory } from './product-category.entity';
import { TraceabilityLevel } from '../traceability-level.enum';

/**
 * What a product is - the catalogue definition, not a physical thing.
 * Physical things carrying this definition are TraceableItem rows.
 *
 * There is deliberately no quantity column. Stock is derived from the
 * identities an organization holds, so inventory cannot drift out of step
 * with the event log (business rule 4).
 *
 * Products are scoped to the organization that created them — one
 * manufacturer's catalogue must not be visible to another.
 */
@Entity('products')
@Index(['organizationId', 'sku'], { unique: true })
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  /** Organization that owns this product definition. */
  @Column({ name: 'organization_id', nullable: false })
  organizationId: number;

  @Column({ nullable: false })
  name: string;

  /** SKU is unique within the owning organization. */
  @Column({ nullable: false })
  sku: string;

  /**
   * The original free-text category, as somebody typed it.
   *
   * Superseded by `categoryId` and kept only as the record of what was
   * originally entered. Nothing should read this for a decision, and new writes
   * go to `categoryId`. It is dropped under separate approval once the last
   * consumer is migrated (DR-05).
   *
   * @deprecated Use {@link categoryId}.
   */
  @Column({ type: 'varchar', nullable: true })
  category: string | null;

  /**
   * What kind of goods this is, from the canonical taxonomy.
   *
   * Nullable because most products genuinely have no category recorded, and
   * inventing one would be a classification nobody made.
   */
  @ManyToOne(() => ProductCategory, { nullable: true, eager: true })
  @JoinColumn({ name: 'category_id' })
  productCategory: ProductCategory | null;

  @Column({ name: 'category_id', type: 'int', nullable: true })
  categoryId: number | null;

  /** The mark it is sold under, from the organization's own brands. */
  @ManyToOne(() => Brand, { nullable: true, eager: true })
  @JoinColumn({ name: 'brand_id' })
  productBrand: Brand | null;

  @Column({ name: 'brand_id', type: 'int', nullable: true })
  brandId: number | null;

  /**
   * How finely this product is traced (DR-01).
   *
   * SERIAL is the default and the strictest: one identity per physical unit.
   * BATCH gives the whole registered quantity one identity, which is what
   * lot-traced goods like yogurt actually need. PACKAGE sits between them.
   *
   * Operationally authoritative. A future regulatory minimum may raise it, never
   * lower it, but no regulatory requirement exists to raise it against yet.
   */
  @Column({
    name: 'traceability_level',
    type: 'varchar',
    default: TraceabilityLevel.SERIAL,
  })
  traceabilityLevel: TraceabilityLevel;

  /**
   * What one unit of `TraceableItem.quantity` is, in words (DR-09).
   *
   * A quantity column with no unit is a number with no noun: stock said "2,016"
   * and left the reader to guess bottles, litres or cases. `RawMaterial` has
   * carried `unit_of_measure` since the beginning; the catalogue simply never
   * adopted it.
   *
   * Display and order entry only. It is **not** stock truth and nothing that
   * counts, values or reserves stock reads it — those all sum
   * `TraceableItem.quantity`, which is what it has always been. Null means the
   * screens show a bare number, exactly as they do today.
   */
  @Column({ name: 'base_unit', type: 'varchar', nullable: true })
  baseUnit: string | null;

  /**
   * The one pack this product is also sold in — a carton, bag, crate or pallet.
   *
   * Deliberately singular. Selling a bottle, a carton *and* a pallet as three
   * tiers is a unit-of-measure engine, and DR-09 keeps this to one conversion
   * so the arithmetic stays somewhere a person can see all of it. A second tier
   * is a decision, not a column added quietly later.
   *
   * Set together with {@link unitsPerPack} or not at all: a pack with no size
   * cannot be converted, and a size with no pack has nothing to name.
   */
  @Column({ name: 'pack_unit', type: 'varchar', nullable: true })
  packUnit: string | null;

  /**
   * How many {@link baseUnit} one {@link packUnit} nominally holds.
   *
   * Nominal, and that word is load-bearing. A real carton's quantity comes from
   * its children through `refreshQuantities()`, and the last carton off a run
   * legitimately holds fewer than a full pack. This number exists so an order
   * for 2,000 bottles can be quoted as 84 cartons *before* any stock exists to
   * measure — which is the one thing the cartons themselves cannot tell you.
   */
  @Column({ name: 'units_per_pack', type: 'int', nullable: true })
  unitsPerPack: number | null;

  @Column({ type: 'varchar', nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  /** Manufacturer barcode (GTIN/EAN/UPC/ISBN) — globally unique. */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  gtin: string | null;

  /**
   * The code type this product's catalogue label prints by default.
   *
   * Set per product because it is a property of the trade, not of the
   * platform: a book prints an ISBN, a bottle of shampoo an EAN-13, a machine
   * part a Code 128. Null means QR, the platform's own identity code, which is
   * the right answer for anything that is not sold through a till.
   *
   * A default, not a restriction - the printing endpoint takes a symbology
   * override, because the same product legitimately carries different codes on
   * the pack, the carton and the pallet.
   */
  @Column({ name: 'barcode_symbology', type: 'varchar', nullable: true })
  barcodeSymbology: Symbology | null;

  @Column({ type: 'text', nullable: true })
  specification: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
