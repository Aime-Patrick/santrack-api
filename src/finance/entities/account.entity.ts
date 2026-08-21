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
import { AccountType } from '../finance.enums';

/**
 * One line of the chart of accounts. The ledger groups by account, so a code
 * that never changes is worth far more than a free-text label - budgets and
 * reports both key on it.
 */
@Entity('accounts')
@Unique('uk_account_org_code', ['organization', 'code'])
@Index('idx_account_org', ['organization'])
export class Account {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ nullable: false })
  code: string;

  @Column({ nullable: false })
  name: string;

  @Column({ type: 'enum', enum: AccountType, nullable: false })
  type: AccountType;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}