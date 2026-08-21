import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Batch } from '../../batch/entities/batch.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { InspectionResult } from '../manufacturing.enums';
import { ProductionOrder } from './production-order.entity';

/**
 * One quality decision about a production order or a batch (proposal section
 * 3, "Quality control"). Records who inspected what and the verdict, so the
 * Approve / Reject / Rework / Quarantine choice leaves an attributable trail.
 */
@Entity('quality_inspections')
@Index('idx_inspection_org', ['organization'])
export class QualityInspection {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => ProductionOrder, { nullable: true, eager: true })
  @JoinColumn({ name: 'production_order_id' })
  productionOrder: ProductionOrder | null;

  @ManyToOne(() => Batch, { nullable: true, eager: true })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch | null;

  @ManyToOne(() => User, { nullable: false, eager: true })
  @JoinColumn({ name: 'inspector_id' })
  inspector: User;

  @Column({ type: 'enum', enum: InspectionResult, nullable: false })
  result: InspectionResult;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'tested_at', type: 'timestamptz' })
  testedAt: Date;
}
