import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import {
  LicensedActivity,
  LicenseEventType,
  LicenseStatus,
} from '../licensing.enums';

/**
 * A kind of licence: what activity it authorises, who may hold it, what
 * documents it demands and which product categories it covers.
 *
 * This is the "depending on what they do" part of the application - it is what
 * stops a dairy licence being used to register medicines.
 */
@Entity('license_categories')
export class LicenseCategory {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ nullable: false })
  code: string;

  @Column({ nullable: false })
  name: string;

  @Column({ type: 'enum', enum: LicensedActivity, nullable: false })
  activity: LicensedActivity;

  /** Which kinds of business may apply for it. */
  @Column({
    name: 'applies_to',
    type: 'enum',
    enum: OrganizationType,
    array: true,
    default: () => "'{}'",
  })
  appliesTo: OrganizationType[];

  /**
   * Product categories this licence permits. Empty means unrestricted, which
   * is the sensible default for warehousing and distribution - they handle
   * whatever they are sent.
   */
  @Column({
    name: 'permitted_product_categories',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  permittedProductCategories: string[];

  /** Document types an applicant must attach before it can be submitted. */
  @Column({
    name: 'required_documents',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  requiredDocuments: string[];

  /** How long an approved licence runs before it must be renewed. */
  @Column({ name: 'validity_months', type: 'int', default: 12 })
  validityMonths: number;

  @Column({ default: true })
  active: boolean;
}

/**
 * One organization's authorisation to carry out one activity.
 *
 * A licence is never permanent: it carries dates, and continuing to operate
 * means periodically re-demonstrating that you still deserve to. Renewal
 * chains through previousLicense rather than overwriting, so the history of
 * who was authorised when survives.
 */
@Entity('licenses')
@Index('idx_license_org', ['organization'])
@Index('idx_license_status', ['status'])
export class License {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'license_number', nullable: false })
  licenseNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => LicenseCategory, { nullable: false, eager: true })
  @JoinColumn({ name: 'category_id' })
  category: LicenseCategory;

  /**
   * The site this licence is about, or null for the business as a whole
   * (DR-07 §4.1).
   *
   * Null means the organization may carry on this activity anywhere; a value
   * means this site only. Every licence issued before DR-07 is null, which is
   * factually correct - none was ever granted against a site.
   *
   * A site-scoped licence replaces the organization-wide one for that site
   * rather than adding to it (D1). The rule lives in `governing-licence.ts`,
   * once, because two implementations of "which licence governs" is how a
   * regulatory verdict becomes non-deterministic.
   */
  @ManyToOne(() => Facility, { nullable: true, eager: true })
  @JoinColumn({ name: 'facility_id' })
  facility: Facility | null;

  @Column({ name: 'facility_id', type: 'int', nullable: true })
  facilityId: number | null;

  @Column({ type: 'enum', enum: LicenseStatus, default: LicenseStatus.DRAFT })
  status: LicenseStatus;

  /** The regulator that approved it. Null until a decision is made. */
  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'issued_by_organization_id' })
  issuedBy: Organization | null;

  /** The individual who screened it. Screening is attributable. */
  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'reviewed_by_id' })
  reviewedBy: User | null;

  /** Dates, not timestamps - a licence is valid for a calendar day. */
  @Column({ name: 'issued_on', type: 'date', nullable: true })
  issuedOn: string | null;

  @Column({ name: 'expires_on', type: 'date', nullable: true })
  expiresOn: string | null;

  /** Why suspended, rejected or revoked. Shown to the holder. */
  @Column({ name: 'status_reason', type: 'varchar', length: 1000, nullable: true })
  statusReason: string | null;

  @Column({ name: 'status_changed_at', type: 'timestamptz', nullable: true })
  statusChangedAt: Date | null;

  /** The licence this one renews, if any. */
  @ManyToOne(() => License, { nullable: true })
  @JoinColumn({ name: 'previous_license_id' })
  previousLicense: License | null;

  /**
   * Issued by the grandfathering migration rather than by a regulator, so
   * organizations already trading when licensing arrived could keep working.
   * Carries a short expiry: it is a grace period, not an exemption.
   */
  @Column({ default: false })
  provisional: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /** True when today falls inside the licence's dates. */
  isWithinDates(on: string): boolean {
    if (this.issuedOn && on < this.issuedOn) {
      return false;
    }
    return !this.expiresOn || on <= this.expiresOn;
  }
}

/** One uploaded certificate attached to a licence application. */
@Entity('license_documents')
@Index('idx_license_document_license', ['license'])
export class LicenseDocument {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => License, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'license_id' })
  license: License;

  /** Matches an entry in the category's requiredDocuments. */
  @Column({ name: 'document_type', nullable: false })
  documentType: string;

  /** As the applicant named it - shown on download, never used as a path. */
  @Column({ nullable: false })
  filename: string;

  @Column({ name: 'content_type', nullable: false })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'int', nullable: false })
  sizeBytes: number;

  /** Opaque handle from the storage provider. Never parsed or constructed. */
  @Column({ name: 'storage_key', nullable: false })
  storageKey: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'uploaded_by_id' })
  uploadedBy: User | null;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt: Date;
}

/**
 * The audit trail of a licence. Append-only for the same reason
 * TraceabilityEvent is: if a regulator ever has to defend a suspension, this
 * is the record that does it.
 */
@Entity('license_events')
@Index('idx_license_event_license', ['license'])
export class LicenseEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => License, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'license_id' })
  license: License;

  @Column({ type: 'enum', enum: LicenseEventType, nullable: false })
  type: LicenseEventType;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ name: 'from_status', type: 'enum', enum: LicenseStatus, nullable: true })
  fromStatus: LicenseStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: LicenseStatus, nullable: true })
  toStatus: LicenseStatus | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'recorded_at' })
  recordedAt: Date;
}
