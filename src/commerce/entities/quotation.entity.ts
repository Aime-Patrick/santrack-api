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
import { QuotationStatus } from '../commerce.enums';
import { Customer } from './customer.entity';

/**
 * A price quotation offered to a customer (proposal section 6). Lines are a
 * snapshot of the product and price at the time - later catalogue changes must
 * not rewrite a quote the customer already saw.
 */
@Entity('quotations')
@Index('idx_quotation_org', ['organization'])
@Index('idx_quotation_customer', ['customer'])
export class Quotation {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'quotation_number', nullable: false })
  quotationNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Customer, { nullable: false, eager: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ type: 'enum', enum: QuotationStatus, default: QuotationStatus.DRAFT })
  status: QuotationStatus;

  @Column({ name: 'valid_until_on', type: 'date', nullable: true })
  validUntilOn: string | null;

  @Column({ name: 'subtotal', type: 'numeric', precision: 14, scale: 2, nullable: true })
  subtotal: string | null;

  @Column({ name: 'tax_percent', type: 'numeric', precision: 5, scale: 2, nullable: true })
  taxPercent: string | null;

  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  totalAmount: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('quotation_lines')
@Index('idx_quotation_line_quotation', ['quotation'])
export class QuotationLine {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Quotation, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quotation_id' })
  quotation: Quotation;

  @ManyToOne(() => Product, { nullable: false, eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 3, nullable: false })
  quantity: string;

  @Column({ name: 'unit_price', type: 'numeric', precision: 14, scale: 2, nullable: false })
  unitPrice: string;

  @Column({ name: 'line_total', type: 'numeric', precision: 14, scale: 2, nullable: true })
  lineTotal: string | null;
}