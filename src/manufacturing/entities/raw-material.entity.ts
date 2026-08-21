import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';

/**
 * One input a factory turns into product. Carries the unit of measure and the
 * last known unit cost so a production order can be costed from what it
 * actually consumed (proposal section 3, "production costing").
 *
 * Raw-material stock is not counted here. Consumption is recorded against
 * production orders; what remains on the shelf is whatever has been bought in
 * but not yet issued, which this module's own records can answer.
 */
@Entity('raw_materials')
@Unique('uk_raw_material_org_code', ['organization', 'code'])
@Index('idx_raw_material_org', ['organization'])
export class RawMaterial {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ nullable: false })
  name: string;

  /** Stable short code, unique within the organization. */
  @Column({ nullable: false })
  code: string;

  @Column({ type: 'varchar', nullable: true })
  category: string | null;

  @Column({ name: 'unit_of_measure', nullable: false })
  unitOfMeasure: string;

  /** Numeric money column: TypeORM returns it as a string, callers convert. */
  @Column({ name: 'unit_cost', type: 'numeric', precision: 14, scale: 2, default: 0 })
  unitCost: string;

  @Column({ name: 'reorder_level', type: 'numeric', precision: 14, scale: 3, default: 0 })
  reorderLevel: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
