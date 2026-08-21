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

/**
 * One privileged action, recorded for the record (technical proposal section
 * 15: audit log). Every mutating request - anything that is not a GET, HEAD or
 * OPTIONS - is written here with who did it, on whose organization and what
 * changed, before the response goes out. The log is append-only: there is no
 * update endpoint, and deleting rows is not a supported workflow.
 */
@Entity('audit_logs')
@Index('idx_audit_org', ['organization'])
@Index('idx_audit_actor', ['actor'])
@Index('idx_audit_path', ['method', 'path'])
@Index('idx_audit_at', ['performedAt'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  /** The organization whose data the action touched; null for global calls. */
  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  @Column({ type: 'varchar', length: 8 })
  method: string;

  @Column({ type: 'varchar', length: 512 })
  path: string;

  /** The response status: 4xx attempts are logged exactly like 2xx actions. */
  @Column({ name: 'status_code', type: 'int' })
  statusCode: number;

  /** A short description of what changed, without any request body secrets. */
  @Column({ type: 'varchar', length: 1000, nullable: true })
  detail: string | null;

  @Column({ name: 'remote_address', type: 'varchar', length: 64, nullable: true })
  remoteAddress: string | null;

  @CreateDateColumn({ name: 'performed_at', type: 'timestamptz' })
  performedAt: Date;
}