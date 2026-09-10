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
import { Organization } from '../../organization/entities/organization.entity';
import { IdentityPool } from '../entities/identity-pool.entity';

/** An authoritative label-print action. */
@Entity('label_print_jobs')
@Index('idx_print_job_org', ['organizationId'])
@Index('idx_print_job_pool', ['poolId'])
@Index('idx_print_job_created_by', ['createdById'])
export class LabelPrintJob {
  @PrimaryGeneratedColumn()
  id: number;

  /** The business that printed labels. */
  @Column({ name: 'organization_id', nullable: false })
  organizationId: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** Which pool the labels came from. */
  @Column({ name: 'pool_id', nullable: false })
  poolId: number;

  @ManyToOne(() => IdentityPool, { nullable: true, eager: true })
  @JoinColumn({ name: 'pool_id' })
  pool: IdentityPool | null;

  /** Which label layout/preset was used. */
  @Column({ name: 'template', type: 'varchar', nullable: false })
  template: string;

  /** How many labels were requested in this print action. */
  @Column({ name: 'quantity', type: 'int', nullable: false })
  quantity: number;

  /** How many labels were actually rendered for this action. */
  @Column({ name: 'rendered_count', type: 'int', nullable: false })
  renderedCount: number;

  /** Who performed the print. */
  @Column({ name: 'created_by_id', nullable: false })
  createdById: number;

  @ManyToOne(() => User, { nullable: false, eager: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
