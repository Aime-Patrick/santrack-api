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
import { Account } from './account.entity';
import { CostCentre } from './cost-centre.entity';

/**
 * A budget for one account and cost centre in one period (proposal section 7,
 * budget management). Reports compare actual postings against the budget to
 * show what a cost centre was given versus what it spent.
 */
@Entity('budgets')
@Index('idx_budget_org', ['organization'])
@Index('idx_budget_account', ['account'])
@Index('idx_budget_cost_centre', ['costCentre'])
export class Budget {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Account, { nullable: false, eager: true })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @ManyToOne(() => CostCentre, { nullable: true, eager: true })
  @JoinColumn({ name: 'cost_centre_id' })
  costCentre: CostCentre | null;

  /** The budgeted period, e.g. '2026-01'. */
  @Column({ nullable: false })
  period: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  amount: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}