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
 * A cost centre to attribute expenses and revenue against - a production
 * line, a department, a warehouse (proposal section 7, cost-centre
 * management). Journal lines attach to a cost centre so reports can answer
 * "what did this line actually cost".
 */
@Entity('cost_centres')
@Unique('uk_cost_centre_org_code', ['organization', 'code'])
@Index('idx_cost_centre_org', ['organization'])
export class CostCentre {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ nullable: false })
  code: string;

  @Column({ nullable: false })
  name: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}