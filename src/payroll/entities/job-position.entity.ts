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
 * A job title within an organization (proposal section 8, job positions).
 */
@Entity('job_positions')
@Unique('uk_job_position_org_code', ['organization', 'code'])
@Index('idx_job_position_org', ['organization'])
export class JobPosition {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ nullable: false })
  code: string;

  @Column({ nullable: false })
  title: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}