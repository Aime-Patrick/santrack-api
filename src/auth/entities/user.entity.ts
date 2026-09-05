import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';
import { Capability } from '../capabilities';
import { UserRole } from '../user-role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ nullable: false })
  email: string;

  /** BCrypt hash. Never selected unless explicitly asked for. */
  @Column({ name: 'password_hash', nullable: false, select: false })
  passwordHash: string;

  /** Optional for invited staff; self-registration still collects a name. */
  @Column({ name: 'full_name', type: 'varchar', nullable: true })
  fullName: string | null;

  /**
   * True when the account was created or reset with a temporary password.
   * Cleared after the user sets their own password.
   */
  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;

  /**
   * SHA-256 of the single-use password-reset token, set by the forgot-password
   * flow. Null once used or expired. Hashed so a leaked users table cannot
   * reset anyone's password.
   */
  @Column({ name: 'password_reset_token', type: 'varchar', nullable: true, select: false })
  passwordResetToken: string | null;

  /** When `passwordResetToken` stops being accepted. */
  @Column({
    name: 'password_reset_expires_at',
    type: 'timestamptz',
    nullable: true,
    select: false,
  })
  passwordResetExpiresAt: Date | null;

  /**
   * Capabilities the platform operator granted to this individual user, on
   * top of what their role and organization confer. Written only through
   * PATCH /api/users/:id/capabilities, which validates against
   * DYNAMICALLY_GRANTABLE_CAPABILITIES.
   */
  @Column({
    name: 'extra_capabilities',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  extraCapabilities: Capability[];

  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.ORG_ADMIN })
  role: UserRole;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
