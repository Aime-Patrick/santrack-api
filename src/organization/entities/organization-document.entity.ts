import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from './organization.entity';

/**
 * A certificate or document uploaded during onboarding.
 * Matches the Digital Tax Stamp system: RDB Certificate, FDA Premise
 * Certificate, Import License, etc.
 */
@Entity('organization_documents')
@Index('idx_org_doc_org', ['organization'])
export class OrganizationDocument {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', nullable: false })
  organizationId: number;

  /** Document type: RDB_CERTIFICATE, FDA_PREMISE, IMPORT_LICENSE, etc. */
  @Column({ name: 'document_type', type: 'varchar', length: 100, nullable: false })
  documentType: string;

  /** Certificate / license number */
  @Column({ name: 'certificate_number', type: 'varchar', length: 200, nullable: true })
  certificateNumber: string | null;

  /** Expiry date of the certificate */
  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  /** Original filename as uploaded */
  @Column({ type: 'varchar', length: 255, nullable: false })
  filename: string;

  /** MIME type */
  @Column({ name: 'content_type', type: 'varchar', length: 120, nullable: false })
  contentType: string;

  /** File size in bytes */
  @Column({ name: 'size_bytes', type: 'int', nullable: false })
  sizeBytes: number;

  /** Storage key (S3/local path) */
  @Column({ name: 'storage_key', type: 'varchar', length: 500, nullable: false })
  storageKey: string;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt: Date;
}
