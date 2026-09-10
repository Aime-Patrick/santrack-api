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
import { License } from './license.entity';
import {
  LicenseFollowUpPriority,
  LicenseFollowUpStatus,
} from '../licensing.enums';

/**
 * A condition, corrective action requirement, or post-licensing follow-up
 * item attached to a license by a regulatory authority (e.g. RSB or Rwanda FDA).
 *
 * Lifecycle:
 *  - OPEN: Assigned by the regulator with a deadline and description of required actions.
 *  - ACTIONED: The license holder/business has completed the required steps and provided explanation + evidence.
 *  - CLOSED: The regulator verified the compliance evidence and signed off / closed the item.
 */
@Entity('license_follow_ups')
@Index('idx_license_followup_license', ['license'])
@Index('idx_license_followup_status', ['status'])
export class LicenseFollowUp {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => License, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'license_id' })
  license: License;

  @Column({ name: 'license_id', type: 'int', nullable: false })
  licenseId: number;

  @Column({ nullable: false })
  title: string;

  @Column({ type: 'text', nullable: false })
  description: string;

  @Column({
    type: 'enum',
    enum: LicenseFollowUpPriority,
    default: LicenseFollowUpPriority.MEDIUM,
  })
  priority: LicenseFollowUpPriority;

  @Column({
    type: 'enum',
    enum: LicenseFollowUpStatus,
    default: LicenseFollowUpStatus.OPEN,
  })
  status: LicenseFollowUpStatus;

  /** Deadline by which the business must resolve or provide evidence */
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  /** Officer/Regulator who created the requirement */
  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  /** Response or corrective actions submitted by the business */
  @Column({ name: 'business_response', type: 'text', nullable: true })
  businessResponse: string | null;

  /** Storage key or link of uploaded proof/evidence */
  @Column({ name: 'evidence_attachment_key', type: 'varchar', nullable: true })
  evidenceAttachmentKey: string | null;

  @Column({ name: 'evidence_filename', type: 'varchar', nullable: true })
  evidenceFilename: string | null;

  /** User who submitted the business action */
  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'actioned_by_id' })
  actionedBy: User | null;

  @Column({ name: 'actioned_at', type: 'timestamptz', nullable: true })
  actionedAt: Date | null;

  /** Officer notes when verifying and closing the condition */
  @Column({ name: 'closure_notes', type: 'text', nullable: true })
  closureNotes: string | null;

  /** Officer who verified and closed */
  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'closed_by_id' })
  closedBy: User | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  // ── Token-based public response link ─────────────────────────────────────

  /**
   * UUID v4 token emailed to the business so they can respond without logging
   * in. Set by the regulator when they choose "Send response link". Null until
   * that action is taken.
   */
  @Column({ name: 'response_token', type: 'uuid', nullable: true, unique: true })
  responseToken: string | null;

  /** When the token expires. Null if no token has been issued. */
  @Column({ name: 'response_token_expires_at', type: 'timestamptz', nullable: true })
  responseTokenExpiresAt: Date | null;

  /** True once the business has submitted a response via the token link. */
  @Column({ name: 'response_token_used', type: 'boolean', default: false })
  responseTokenUsed: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
