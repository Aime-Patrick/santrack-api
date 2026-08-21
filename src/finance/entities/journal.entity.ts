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
import { Account } from './account.entity';
import { CostCentre } from './cost-centre.entity';

/**
 * A balanced, double-entry posting (proposal section 7). The entry header
 * names the transaction; its lines are the debits and credits that must sum
 * to zero.
 */
@Entity('journal_entries')
@Index('idx_journal_org', ['organization'])
@Index('idx_journal_posted_on', ['postedOn'])
export class JournalEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'entry_number', nullable: false })
  entryNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'varchar', length: 1000, nullable: false })
  description: string;

  @Column({ name: 'posted_on', type: 'date', nullable: true })
  postedOn: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('journal_lines')
@Index('idx_journal_line_entry', ['entry'])
@Index('idx_journal_line_account', ['account'])
@Index('idx_journal_line_cost_centre', ['costCentre'])
export class JournalLine {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => JournalEntry, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entry_id' })
  entry: JournalEntry;

  @ManyToOne(() => Account, { nullable: false, eager: true })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @ManyToOne(() => CostCentre, { nullable: true, eager: true })
  @JoinColumn({ name: 'cost_centre_id' })
  costCentre: CostCentre | null;

  /** Money as strings: the ledger never passes amounts through a float. */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  debit: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  credit: string;
}