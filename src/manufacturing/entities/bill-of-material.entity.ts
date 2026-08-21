import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { RawMaterial } from './raw-material.entity';

/**
 * A recipe: which raw materials and what quantity of each go into one unit of
 * a finished product (proposal section 3, "Bill of Materials").
 *
 * One BOM is active per product at a time. Creating a newer version retires
 * the old one rather than editing it, so what a past production run was made
 * from stays answerable.
 */
@Entity('bill_of_materials')
@Index('idx_bom_org', ['organization'])
@Index('idx_bom_product', ['product'])
export class BillOfMaterial {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Product, { nullable: false, eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  /** 1, 2, 3... incremented for each new recipe for the same product. */
  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

/** One row of a recipe: a material and how much one unit needs. */
@Entity('bill_of_material_lines')
@Index('idx_bom_line_bom', ['bom'])
export class BillOfMaterialLine {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => BillOfMaterial, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bom_id' })
  bom: BillOfMaterial;

  @ManyToOne(() => RawMaterial, { nullable: false, eager: true })
  @JoinColumn({ name: 'material_id' })
  material: RawMaterial;

  @Column({
    name: 'quantity_per_unit',
    type: 'numeric',
    precision: 14,
    scale: 3,
    nullable: false,
  })
  quantityPerUnit: string;

  /**
   * Expected process loss, as a percentage. Used to lift the allocation above
   * the theoretical quantity so the line is never short on the last unit.
   */
  @Column({ name: 'wastage_percent', type: 'numeric', precision: 5, scale: 2, default: 0 })
  wastagePercent: string;
}
