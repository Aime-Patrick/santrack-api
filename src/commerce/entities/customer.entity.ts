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
import { CustomerSegment, CustomerType } from '../commerce.enums';

/**
 * A client of the seller's organization, registered for the commercial layer
 * (proposal section 6). A final consumer can be kept as a lightweight customer
 * for sales history; a business customer is what quotations, orders, invoices
 * and credit revolve around.
 */
@Entity('customers')
@Unique('uk_customer_org_code', ['organization', 'code'])
@Index('idx_customer_org', ['organization'])
export class Customer {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * The seller. This is the tenant scope - whose customer list this record
   * belongs to - and never the party being sold to.
   */
  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /**
   * The buyer, when the buyer is itself a business on the platform.
   *
   * Null for everyone else, which is most of them: a shop that keeps a walk-in
   * account, a hospital that never registered. That distinction decides what
   * fulfilment means. With an organization here the goods stay inside the
   * traceable chain and travel by transfer, which the buyer confirms on
   * receipt; without one they leave it, and fulfilment is a sale.
   *
   * It is deliberately not derived from `email` or `name`. Guessing which
   * organization a customer record refers to would hand custody of real stock
   * to whoever happened to match.
   */
  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'buyer_organization_id' })
  buyerOrganization: Organization | null;

  /** Stable short code, unique within the organization. */
  @Column({ nullable: false })
  code: string;

  @Column({ nullable: false })
  name: string;

  @Column({ type: 'enum', enum: CustomerType, nullable: false })
  type: CustomerType;

  @Column({ type: 'enum', enum: CustomerSegment, default: CustomerSegment.RETAIL })
  segment: CustomerSegment;

  @Column({ name: 'contact_person', type: 'varchar', nullable: true })
  contactPerson: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  address: string | null;

  /** The ceiling the organization will sell to this customer on credit. */
  @Column({ name: 'credit_limit', type: 'numeric', precision: 14, scale: 2, nullable: true })
  creditLimit: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}