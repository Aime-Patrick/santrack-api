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
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { TraceableItem } from '../../item/entities/traceable-item.entity';

export enum SaleType {
  /** Onward to another business; custody follows the dispatch/receive flow. */
  BUSINESS = 'BUSINESS',
  /** Out of the trade to a final consumer; the chain ends here. */
  CONSUMER = 'CONSUMER',
}

@Entity('sales')
@Index('idx_sale_seller', ['sellerOrganization'])
export class Sale {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ nullable: false })
  reference: string;

  @Column({ type: 'enum', enum: SaleType, nullable: false })
  type: SaleType;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'seller_organization_id' })
  sellerOrganization: Organization;

  @ManyToOne(() => Location, { nullable: true, eager: true })
  @JoinColumn({ name: 'seller_location_id' })
  sellerLocation: Location | null;

  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'buyer_organization_id' })
  buyerOrganization: Organization | null;

  /**
   * A phone number, receipt number or opaque token - not a customer account.
   * A final consumer never operates a business account (proposal section 8).
   */
  @Column({ name: 'consumer_ref', type: 'varchar', nullable: true })
  consumerRef: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'sold_by_id' })
  soldBy: User | null;

  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  totalAmount: string | null;

  /** Set for business sales: the dispatch that carries custody to the buyer. */
  @Column({ name: 'transfer_id', type: 'int', nullable: true })
  transferId: number | null;

  @CreateDateColumn({ name: 'sold_at' })
  soldAt: Date;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;
}

@Entity('sale_lines')
@Index('idx_sale_line_sale', ['sale'])
export class SaleLine {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Sale, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sale_id' })
  sale: Sale;

  @ManyToOne(() => TraceableItem, { nullable: false, eager: true })
  @JoinColumn({ name: 'item_id' })
  item: TraceableItem;

  @Column({ nullable: false, default: 1 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'numeric', precision: 14, scale: 2, nullable: true })
  unitPrice: string | null;
}
