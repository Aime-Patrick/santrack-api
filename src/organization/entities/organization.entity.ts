import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrganizationType } from '../organization-type.enum';
import { OnboardingStatus } from '../onboarding-status.enum';
import { OrganizationOwner } from './organization-owner.entity';

/** A participating business or entity in the traceability chain. */
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ nullable: false })
  name: string;

  @Column({ type: 'enum', enum: OrganizationType, nullable: false })
  type: OrganizationType;

  /**
   * Rwanda Tax Identification Number. Collected at business registration so
   * industry oversight and licensing can match the legal entity.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  tin: string | null;

  /** Company / trade registration number when the applicant has one. */
  @Column({ name: 'registration_number', type: 'varchar', length: 64, nullable: true })
  registrationNumber: string | null;

  // ── Onboarding fields (matching Digital Tax Stamp requirements) ──

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string | null;

  @Column({ name: 'license_type', type: 'varchar', length: 100, nullable: true })
  licenseType: string | null;

  @Column({ name: 'date_incorporated', type: 'date', nullable: true })
  dateIncorporated: string | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  description: string | null;

  // ── Rwanda address hierarchy ──

  @Column({ type: 'varchar', length: 100, nullable: true })
  province: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  district: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sector: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  cell: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  village: string | null;

  // ── Registration approval (Digital Tax Stamp flow) ──

  /**
   * New self-registrations land as PENDING and stay there until a regulator
   * approves or rejects them. No licence is issued while pending.
   */
  @Column({
    name: 'onboarding_status',
    type: 'enum',
    enum: OnboardingStatus,
    default: OnboardingStatus.PENDING,
    nullable: false,
  })
  onboardingStatus: OnboardingStatus;

  /** Why a registration was rejected; null until a rejection happens. */
  @Column({
    name: 'rejection_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  rejectionReason: string | null;

  /** Declared owners, filed with the registration application. */
  @OneToMany(() => OrganizationOwner, (owner) => owner.organization)
  owners: OrganizationOwner[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /** Regulators read across organization boundaries (proposal section 12). */
  isRegulator(): boolean {
    return this.type === OrganizationType.REGULATOR;
  }
}
