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
