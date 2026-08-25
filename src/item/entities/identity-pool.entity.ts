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
import { Product } from '../../product/entities/product.entity';

/**
 * How far along the minting job is.
 *
 * Ten thousand identities are more rows than one request should hold open, so
 * generation runs as a job and the pool carries its state. A pool is useful
 * the moment the first codes land - a factory can start printing while the
 * rest mint - so GENERATING is a working state, not a locked one.
 */
export enum PoolStatus {
  GENERATING = 'GENERATING',
  READY = 'READY',
  /** The job stopped part-way. Whatever minted is real and stays. */
  FAILED = 'FAILED',
}

/**
 * A request for identities: "prepare ten thousand codes for Akagera Water
 * 500ml".
 *
 * This exists because a factory has to print labels before it can stick them
 * on bottles, so codes must be mintable before anything is produced (DR-08).
 * The pool is the record of that request - who asked, for which product, how
 * many, and when - so that the ten thousand codes are one traceable act rather
 * than ten thousand unrelated rows.
 *
 * Deliberately scoped to a product rather than to a production order. The
 * order comes later and may not exist yet: a plant prints a run of labels and
 * then schedules six thousand bottles this week and four thousand next, which
 * is two orders drawing on one pool. Tying the pool to an order would force
 * that decision at printing time, before anybody has made it.
 *
 * There is no minted-count column, for the same reason Product has no quantity
 * column: it would be a second copy of a fact the identities already hold, and
 * the two would drift. How many minted, how many produced, how many cancelled
 * are all counted from `traceable_items`.
 */
@Entity('identity_pools')
@Index('idx_pool_product', ['product'])
@Index('idx_pool_organization', ['organizationId'])
export class IdentityPool {
  @PrimaryGeneratedColumn()
  id: number;

  /** The business that requested the codes and owns them. */
  @Column({ name: 'organization_id', nullable: false })
  organizationId: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** What these codes will name, once something is produced under them. */
  @ManyToOne(() => Product, { nullable: false, eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  /**
   * How many codes were asked for. Fixed at creation and never edited: a pool
   * is a record of a request, and a request that changes retroactively cannot
   * be reconciled against what was printed. Needing more codes means a new
   * pool.
   */
  @Column({ name: 'requested_count', type: 'int', nullable: false, update: false })
  requestedCount: number;

  @Column({
    name: 'status',
    type: 'varchar',
    nullable: false,
    default: PoolStatus.GENERATING,
  })
  status: PoolStatus;

  /** Why the minting job stopped, when it did. */
  @Column({ name: 'failure_reason', type: 'varchar', nullable: true })
  failureReason: string | null;

  /** Who asked for the codes. Kept for the audit trail, never for display. */
  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /** When the last code landed. Null while still minting. */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
