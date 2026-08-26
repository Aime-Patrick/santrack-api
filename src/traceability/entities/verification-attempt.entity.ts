import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TraceableItem } from '../../item/entities/traceable-item.entity';

/**
 * How often each code has been presented to the public verification endpoint.
 *
 * The `VERIFIED` lifecycle event covers scans of codes we recognise, but it
 * can only exist where there is an identity to attach it to. That left the
 * more interesting half unrecorded: a code that resolves to nothing. A
 * fabricated label could be scanned a thousand times and the platform would
 * hold no evidence anybody had ever asked about it.
 *
 * **One row per distinct code, not per scan.** The endpoint is public and
 * anonymous, so a row per scan would let anyone with a loop decide how large
 * this table gets. Counting instead bounds it by the number of distinct codes
 * in circulation, and answers the question that actually matters — *how many
 * times has this one been checked* — in a single read.
 *
 * **Known codes are counted too, and that is the important case.** A cloned
 * label carries a real code; the give-away is one genuine identity being
 * verified far more often than one bottle could be. Recording only unknown
 * codes would miss every competent counterfeit.
 *
 * Nothing here identifies a scanner. No account, no address, no location — the
 * row says a code was checked and how often, and that is all it will ever say.
 * Which means high counts are a signal to investigate, never proof on their
 * own: a display bottle on a shop counter gets scanned all day by curious
 * customers and is not a fake.
 */
@Entity('verification_attempts')
@Index('idx_verification_attempt_last_seen', ['lastSeenAt'])
@Index('idx_verification_attempt_known', ['known'])
export class VerificationAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * The code as it was presented. Unique — this row *is* the code's history.
   *
   * Length-capped and stored verbatim rather than parsed. An unknown token is
   * unknown precisely because it fits no format we control, and normalising it
   * would destroy the evidence of what was actually printed on the label.
   */
  @Index('idx_verification_attempt_token', { unique: true })
  @Column({ type: 'varchar', length: 256, nullable: false })
  token: string;

  /** Whether this code resolved to a real identity at the last attempt. */
  @Column({ type: 'boolean', nullable: false, default: false })
  known: boolean;

  /** The identity it resolves to, when it resolves to one. */
  @ManyToOne(() => TraceableItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'item_id' })
  item: TraceableItem | null;

  @Column({ type: 'int', nullable: false, default: 1 })
  attempts: number;

  @Column({ name: 'first_seen_at', type: 'timestamptz', nullable: false })
  firstSeenAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: false })
  lastSeenAt: Date;
}

/**
 * The longest token we will store. Anything longer is truncated rather than
 * rejected: an over-length scan is still worth counting, and refusing to
 * record it would hand anyone a way to probe without leaving a mark.
 */
export const MAX_VERIFICATION_TOKEN = 256;
