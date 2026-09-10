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
import { RegulatoryAuthority } from '../../licensing/entities/regulatory-authority.entity';
import { Organization } from './organization.entity';

/**
 * The verdict a secondary authority gives when consulted on a registration.
 *
 * Three values rather than binary, because "we have concerns but we are not
 * blocking" is a real and important answer: it lets the primary regulator
 * make an informed decision — e.g. issue with conditions — rather than
 * being forced into a hard approve/reject.
 */
export enum ConsultationVerdict {
  /** No issues found — the secondary authority is satisfied. */
  APPROVED = 'APPROVED',
  /** Issues noted but not blocking — primary regulator should be aware. */
  CONCERNS = 'CONCERNS',
  /** Blocking issue — the secondary authority objects to this registration. */
  OBJECTION = 'OBJECTION',
}

/**
 * Lifecycle state of one inter-authority consultation request.
 *
 * The primary authority always retains ownership of the registration.
 * Consulting another authority does not transfer it — that is the key
 * difference from RegulatoryCaseReferral, which transfers leadAuthority on
 * acceptance.
 */
export enum ConsultationStatus {
  /** Sent; the secondary authority has not yet responded. */
  PENDING = 'PENDING',
  /** The secondary authority has submitted their verdict. */
  RESPONDED = 'RESPONDED',
  /** Cancelled by the primary authority before a response was given. */
  CANCELLED = 'CANCELLED',
  /**
   * The due date has passed with no response. Recorded by the expiry sweep;
   * the primary regulator's dashboard surfaces these for follow-up.
   */
  OVERDUE = 'OVERDUE',
}

/**
 * One inter-agency advisory consultation on a registration application.
 *
 * When RSB needs Rwanda FDA's opinion before approving a food manufacturer,
 * or when RMB needs REMA's environmental clearance before licensing a mine,
 * they open one of these. The primary authority retains ownership of the
 * registration throughout; the secondary authority responds with a verdict
 * and notes. The primary authority then makes the final decision.
 *
 * Distinct from RegulatoryCaseReferral (which is for enforcement cases and
 * transfers case ownership on acceptance). Consultations are advisory and
 * non-transferring.
 *
 * One row per (organization, fromAuthority, toAuthority) consultation round.
 * A primary authority may consult multiple secondary authorities in parallel,
 * and may open a second consultation on the same authority after the first
 * is resolved.
 */
@Entity('registration_consultations')
@Index('idx_reg_consultation_org', ['organization'])
@Index('idx_reg_consultation_to_authority_status', ['toAuthority', 'status'])
@Index('idx_reg_consultation_from_authority', ['fromAuthority'])
export class RegistrationConsultation {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * The applicant this consultation is about. The secondary authority reads
   * the application details through this relation.
   */
  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /**
   * The authority initiating the consultation (the primary reviewer).
   * Always retains ownership of the registration decision.
   */
  @ManyToOne(() => RegulatoryAuthority, { nullable: false, eager: true })
  @JoinColumn({ name: 'from_authority_id' })
  fromAuthority: RegulatoryAuthority;

  /**
   * The authority being consulted (the secondary reviewer).
   * Responds with a verdict and notes; cannot approve or reject the
   * registration itself.
   */
  @ManyToOne(() => RegulatoryAuthority, { nullable: false, eager: true })
  @JoinColumn({ name: 'to_authority_id' })
  toAuthority: RegulatoryAuthority;

  /**
   * What specifically the primary authority is asking about.
   * e.g. "Verify FDA Premise Certificate and food safety compliance"
   */
  @Column({ type: 'varchar', length: 300, nullable: false })
  subject: string;

  /**
   * Background context for the secondary authority — what documents to
   * check, what the concern is, any relevant details from the application.
   */
  @Column({ name: 'context_note', type: 'text', nullable: true })
  contextNote: string | null;

  /**
   * IDs of organization_documents forwarded to the secondary authority.
   * The primary authority selects which documents to share — not all
   * of the applicant's documents are necessarily relevant to every
   * secondary authority.
   */
  @Column({
    name: 'forwarded_document_ids',
    type: 'int',
    array: true,
    default: () => "'{}'",
  })
  forwardedDocumentIds: number[];

  @Column({
    type: 'enum',
    enum: ConsultationStatus,
    default: ConsultationStatus.PENDING,
    nullable: false,
  })
  status: ConsultationStatus;

  /**
   * The secondary authority's verdict, set when they respond.
   * Null until the consultation is RESPONDED.
   */
  @Column({
    type: 'enum',
    enum: ConsultationVerdict,
    nullable: true,
  })
  verdict: ConsultationVerdict | null;

  /**
   * The secondary authority's response notes — what they found, what
   * conditions they suggest, why they object.
   */
  @Column({ name: 'response_note', type: 'text', nullable: true })
  responseNote: string | null;

  /**
   * Optional SLA date. When the expiry sweep finds a PENDING consultation
   * past this date, it flips the status to OVERDUE and records on the
   * primary authority's dashboard.
   */
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @ManyToOne(() => User, { nullable: false, eager: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'responded_by_id' })
  respondedBy: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;
}
