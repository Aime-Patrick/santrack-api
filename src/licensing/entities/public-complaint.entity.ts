import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Batch } from '../../batch/entities/batch.entity';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { RegulatoryCase } from './regulatory-case.entity';
import { User } from '../../auth/entities/user.entity';

export enum PublicComplaintIssue {
  SUSPECTED_COUNTERFEIT = 'SUSPECTED_COUNTERFEIT',
  ILLNESS = 'ILLNESS',
  DAMAGED = 'DAMAGED',
  EXPIRED = 'EXPIRED',
  OTHER = 'OTHER',
}

export enum PublicComplaintStatus {
  TRIAGE = 'TRIAGE',
  PROMOTED = 'PROMOTED',
  DISMISSED = 'DISMISSED',
}

/** A privacy-minimised market signal submitted from the public verification page. */
@Entity('public_complaints')
@Index('idx_public_complaint_received', ['receivedAt'])
@Index('idx_public_complaint_batch', ['batch'])
export class PublicComplaint {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 256 })
  token: string;

  @ManyToOne(() => TraceableItem, { nullable: true, eager: true })
  @JoinColumn({ name: 'item_id' })
  item: TraceableItem | null;

  @ManyToOne(() => Batch, { nullable: true, eager: true })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch | null;

  @Column({ type: 'enum', enum: PublicComplaintIssue })
  issue: PublicComplaintIssue;

  @Column({ type: 'enum', enum: PublicComplaintStatus, default: PublicComplaintStatus.TRIAGE })
  status: PublicComplaintStatus;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  note: string | null;

  /** Free-text area, deliberately not GPS or an address. */
  @Column({ name: 'location_hint', type: 'varchar', length: 180, nullable: true })
  locationHint: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  contact: string | null;

  @Column({ name: 'photo_key', type: 'varchar', length: 500, nullable: true })
  photoKey: string | null;

  @Column({ name: 'photo_name', type: 'varchar', length: 255, nullable: true })
  photoName: string | null;

  @ManyToOne(() => RegulatoryCase, { nullable: true, eager: true })
  @JoinColumn({ name: 'case_id' })
  regulatoryCase: RegulatoryCase | null;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'reviewed_by_id' })
  reviewedBy: User | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;
}
