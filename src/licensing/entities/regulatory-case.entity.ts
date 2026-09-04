import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Batch } from '../../batch/entities/batch.entity';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { ComplianceFinding } from './compliance-finding.entity';
import { License } from './license.entity';
import { RegulatoryAuthority } from './regulatory-authority.entity';

export enum RegulatoryCaseStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  AWAITING_BUSINESS = 'AWAITING_BUSINESS',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum RegulatoryCasePriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum RegulatoryCaseEventType {
  OPENED = 'OPENED',
  ASSIGNED = 'ASSIGNED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  INSPECTION_RECORDED = 'INSPECTION_RECORDED',
  EVIDENCE_SUBMITTED = 'EVIDENCE_SUBMITTED',
  DEADLINE_OVERDUE = 'DEADLINE_OVERDUE',
  DEADLINE_ESCALATED = 'DEADLINE_ESCALATED',
  RECALL_RECOVERY_RECORDED = 'RECALL_RECOVERY_RECORDED',
  NOTE_ADDED = 'NOTE_ADDED',
  REFERRED = 'REFERRED',
  REFERRAL_ACCEPTED = 'REFERRAL_ACCEPTED',
  REFERRAL_REJECTED = 'REFERRAL_REJECTED',
}

/**
 * A regulator's live work item. Source records such as findings and licence
 * events remain immutable facts; this record owns assignment, deadlines and
 * the accountable follow-up required to resolve those facts.
 */
@Entity('regulatory_cases')
@Index('idx_regulatory_case_status', ['status'])
@Index('idx_regulatory_case_organization', ['organization'])
@Index('idx_regulatory_case_assignee', ['assignedTo'])
@Index('idx_regulatory_case_lead_authority', ['leadAuthority'])
export class RegulatoryCase {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'case_number', type: 'varchar', length: 32, nullable: true })
  caseNumber: string | null;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** The authority accountable for the case, not the facility's location. */
  @ManyToOne(() => RegulatoryAuthority, { nullable: true, eager: true })
  @JoinColumn({ name: 'lead_authority_id' })
  leadAuthority: RegulatoryAuthority | null;

  /** Authority-defined triage label; never a hard-coded platform taxonomy. */
  @Column({ name: 'case_category', type: 'varchar', length: 100, nullable: true })
  caseCategory: string | null;

  /** Optional authority-defined team responsible before an officer is assigned. */
  @Column({ name: 'assigned_team', type: 'varchar', length: 100, nullable: true })
  assignedTeam: string | null;

  @ManyToOne(() => Facility, { nullable: true, eager: true })
  @JoinColumn({ name: 'facility_id' })
  facility: Facility | null;

  @ManyToOne(() => License, { nullable: true, eager: true })
  @JoinColumn({ name: 'license_id' })
  license: License | null;

  @ManyToOne(() => ComplianceFinding, { nullable: true, eager: true })
  @JoinColumn({ name: 'finding_id' })
  finding: ComplianceFinding | null;

  @ManyToOne(() => Batch, { nullable: true, eager: true })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch | null;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo: User | null;

  @Column({ type: 'varchar', length: 180 })
  title: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: RegulatoryCasePriority, default: RegulatoryCasePriority.NORMAL })
  priority: RegulatoryCasePriority;

  @Column({ type: 'enum', enum: RegulatoryCaseStatus, default: RegulatoryCaseStatus.OPEN })
  status: RegulatoryCaseStatus;

  @Column({ name: 'due_on', type: 'date', nullable: true })
  dueOn: string | null;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'opened_by_id' })
  openedBy: User | null;

  @CreateDateColumn({ name: 'opened_at', type: 'timestamptz' })
  openedAt: Date;

  @OneToMany(() => RegulatoryCaseEvent, (event) => event.case)
  events: RegulatoryCaseEvent[];

  @OneToMany(() => RegulatoryCaseEvidence, (evidence) => evidence.case)
  evidence: RegulatoryCaseEvidence[];
}

export enum RegulatoryCaseReferralStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

/** A durable, two-party handoff. Receiving an authority must explicitly accept it. */
@Entity('regulatory_case_referrals')
@Index('idx_regulatory_case_referral_recipient_status', ['toAuthority', 'status'])
export class RegulatoryCaseReferral {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => RegulatoryCase, { nullable: false, onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'case_id' })
  case: RegulatoryCase;

  @ManyToOne(() => RegulatoryAuthority, { nullable: false, eager: true })
  @JoinColumn({ name: 'from_authority_id' })
  fromAuthority: RegulatoryAuthority;

  @ManyToOne(() => RegulatoryAuthority, { nullable: false, eager: true })
  @JoinColumn({ name: 'to_authority_id' })
  toAuthority: RegulatoryAuthority;

  @Column({ type: 'enum', enum: RegulatoryCaseReferralStatus, default: RegulatoryCaseReferralStatus.PENDING })
  status: RegulatoryCaseReferralStatus;

  @Column({ type: 'varchar', length: 1000 })
  reason: string;

  @ManyToOne(() => User, { nullable: false, eager: true })
  @JoinColumn({ name: 'referred_by_id' })
  referredBy: User;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'decided_by_id' })
  decidedBy: User | null;

  @Column({ name: 'decision_note', type: 'varchar', length: 1000, nullable: true })
  decisionNote: string | null;

  @CreateDateColumn({ name: 'referred_at', type: 'timestamptz' })
  referredAt: Date;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;
}

/** Append-only record of every decision and hand-off inside a regulatory case. */
@Entity('regulatory_case_events')
@Index('idx_regulatory_case_event_case_recorded', ['case', 'recordedAt'])
export class RegulatoryCaseEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => RegulatoryCase, (caseRecord) => caseRecord.events, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'case_id' })
  case: RegulatoryCase;

  @Column({ type: 'enum', enum: RegulatoryCaseEventType })
  type: RegulatoryCaseEventType;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ type: 'varchar', length: 1000 })
  summary: string;

  @Column({ type: 'jsonb', nullable: true })
  detail: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;
}

/** Files a business submits to demonstrate corrective action on a case. */
@Entity('regulatory_case_evidence')
@Index('idx_regulatory_case_evidence_case_submitted', ['case', 'submittedAt'])
export class RegulatoryCaseEvidence {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => RegulatoryCase, (caseRecord) => caseRecord.evidence, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'case_id' })
  case: RegulatoryCase;

  @ManyToOne(() => User, { nullable: false, eager: true })
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy: User;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ name: 'content_type', type: 'varchar', length: 120 })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes: number;

  @Column({ name: 'storage_key', type: 'varchar', length: 500, unique: true })
  storageKey: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt: Date;
}
