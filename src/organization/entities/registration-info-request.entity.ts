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
import { Organization } from './organization.entity';

export enum InfoRequestStatus {
  /** Sent to applicant, awaiting response. */
  PENDING = 'PENDING',
  /** Applicant has submitted their response. */
  RESPONDED = 'RESPONDED',
  /** Token expired without a response. */
  EXPIRED = 'EXPIRED',
}

/**
 * A regulator-initiated request for additional information from an applicant.
 *
 * The regulator specifies what fields/documents they need; a secure token is
 * generated and emailed to the applicant. The applicant visits a public URL
 * that validates the token and renders the dynamic form, then submits the
 * requested information without needing to log in.
 *
 * One organization can have multiple of these over the course of its
 * registration lifecycle (e.g. one for missing FDA cert, another later for a
 * different document).
 */
@Entity('registration_info_requests')
@Index('idx_info_request_org', ['organizationId'])
export class RegistrationInfoRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', nullable: false })
  organizationId: number;

  /**
   * Cryptographically random UUID v4 — serves as the auth mechanism for
   * the public response page. Indexed for fast lookup.
   */
  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: false })
  token: string;

  /**
   * The regulator's message to the applicant: explains why additional
   * information is required and what, specifically, they should provide.
   */
  @Column({ name: 'request_message', type: 'text', nullable: false })
  requestMessage: string;

  /**
   * JSON array of field descriptors the regulator configured for this
   * specific request. Each entry describes one piece of information or
   * document the applicant must provide.
   *
   * Shape: Array<{ key: string; label: string; type: 'text' | 'file'; required: boolean }>
   */
  @Column({ name: 'requested_fields', type: 'jsonb', default: '[]' })
  requestedFields: Array<{
    key: string;
    label: string;
    type: 'text' | 'file';
    required: boolean;
  }>;

  /** Token / request expires at this UTC timestamp. */
  @Column({ name: 'expires_at', type: 'timestamp with time zone', nullable: false })
  expiresAt: Date;

  @Column({
    name: 'status',
    type: 'enum',
    enum: InfoRequestStatus,
    default: InfoRequestStatus.PENDING,
    nullable: false,
  })
  status: InfoRequestStatus;

  /**
   * The applicant's text response (key→value map). Populated on submission.
   */
  @Column({ name: 'response_data', type: 'jsonb', nullable: true })
  responseData: Record<string, string> | null;

  /**
   * Any uploaded file storage key (one primary attachment per request).
   * For multi-file scenarios the applicant can upload additional documents
   * through the existing /api/organizations/:id/documents endpoint once
   * we've confirmed their identity via token consumption.
   */
  @Column({ name: 'response_attachment_key', type: 'varchar', nullable: true })
  responseAttachmentKey: string | null;

  @Column({ name: 'response_attachment_filename', type: 'varchar', nullable: true })
  responseAttachmentFilename: string | null;

  /** When the applicant submitted their response. */
  @Column({ name: 'responded_at', type: 'timestamp with time zone', nullable: true })
  respondedAt: Date | null;

  /** The regulator user who created this request. */
  @Column({ name: 'created_by_id', type: 'integer', nullable: true })
  createdById: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
