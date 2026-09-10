import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from './product.entity';
import { ProductCategory } from './product-category.entity';

export enum ProductRegistrationStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum ProductRegistrationEventType {
  APPLIED = 'APPLIED',
  DOCUMENT_ATTACHED = 'DOCUMENT_ATTACHED',
  SUBMITTED = 'SUBMITTED',
  REVIEW_STARTED = 'REVIEW_STARTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
  REINSTATED = 'REINSTATED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

@Entity('product_registrations')
@Index('idx_prod_reg_org', ['organization'])
@Index('idx_prod_reg_status', ['status'])
export class ProductRegistration {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'registration_number', nullable: false })
  registrationNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', nullable: false })
  organizationId: number;

  @ManyToOne(() => Facility, { nullable: true, eager: true })
  @JoinColumn({ name: 'facility_id' })
  facility: Facility | null;

  @Column({ name: 'facility_id', type: 'int', nullable: true })
  facilityId: number | null;

  @ManyToOne(() => Product, { nullable: true, eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  @Column({ name: 'product_id', type: 'int', nullable: true })
  productId: number | null;

  @ManyToOne(() => ProductCategory, { nullable: true, eager: true })
  @JoinColumn({ name: 'category_id' })
  category: ProductCategory | null;

  @Column({ name: 'category_id', type: 'int', nullable: true })
  categoryId: number | null;

  @Column({ name: 'product_name', nullable: false })
  productName: string;

  @Column({ name: 'brand_name', type: 'varchar', nullable: true })
  brandName: string | null;

  @Column({ name: 'intended_use', type: 'text', nullable: true })
  intendedUse: string | null;

  @Column({ name: 'target_consumer', type: 'varchar', nullable: true })
  targetConsumer: string | null;

  @Column({ type: 'jsonb', nullable: true, default: () => "'[]'" })
  ingredients: Array<{ name: string; percentage?: number; purpose?: string }> | null;

  @Column({ name: 'net_contents', type: 'text', array: true, default: () => "'{}'" })
  netContents: string[];

  @Column({ name: 'shelf_life_months', type: 'int', nullable: true })
  shelfLifeMonths: number | null;

  @Column({ name: 'storage_conditions', type: 'varchar', nullable: true })
  storageConditions: string | null;

  @Column({ name: 'rsb_standard_number', type: 'varchar', nullable: true })
  rsbStandardNumber: string | null;

  @Column({
    type: 'enum',
    enum: ProductRegistrationStatus,
    default: ProductRegistrationStatus.DRAFT,
  })
  status: ProductRegistrationStatus;

  @Column({ name: 'status_reason', type: 'varchar', length: 1000, nullable: true })
  statusReason: string | null;

  @Column({ name: 'status_changed_at', type: 'timestamptz', nullable: true })
  statusChangedAt: Date | null;

  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'issued_by_organization_id' })
  issuedBy: Organization | null;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'reviewed_by_id' })
  reviewedBy: User | null;

  @Column({ name: 'issued_on', type: 'date', nullable: true })
  issuedOn: string | null;

  @Column({ name: 'expires_on', type: 'date', nullable: true })
  expiresOn: string | null;

  @OneToMany(
    () => ProductRegistrationDocument,
    (doc) => doc.productRegistration,
  )
  documents: ProductRegistrationDocument[];

  @OneToMany(() => ProductRegistrationEvent, (evt) => evt.productRegistration)
  events: ProductRegistrationEvent[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('product_registration_documents')
@Index('idx_prod_reg_doc_reg', ['productRegistration'])
export class ProductRegistrationDocument {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProductRegistration, (reg) => reg.documents, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'product_registration_id' })
  productRegistration: ProductRegistration;

  @Column({ name: 'document_type', nullable: false })
  documentType: string;

  @Column({ nullable: false })
  filename: string;

  @Column({ name: 'content_type', nullable: false })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'int', nullable: false })
  sizeBytes: number;

  @Column({ name: 'storage_key', nullable: false })
  storageKey: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'uploaded_by_id' })
  uploadedBy: User | null;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt: Date;
}

@Entity('product_registration_events')
@Index('idx_prod_reg_event_reg', ['productRegistration'])
export class ProductRegistrationEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProductRegistration, (reg) => reg.events, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'product_registration_id' })
  productRegistration: ProductRegistration;

  @Column({ type: 'enum', enum: ProductRegistrationEventType, nullable: false })
  type: ProductRegistrationEventType;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({
    name: 'from_status',
    type: 'enum',
    enum: ProductRegistrationStatus,
    nullable: true,
  })
  fromStatus: ProductRegistrationStatus | null;

  @Column({
    name: 'to_status',
    type: 'enum',
    enum: ProductRegistrationStatus,
    nullable: true,
  })
  toStatus: ProductRegistrationStatus | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'recorded_at' })
  recordedAt: Date;
}
