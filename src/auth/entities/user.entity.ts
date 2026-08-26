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

  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.ORG_ADMIN })
  role: UserRole;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
