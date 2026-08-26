import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrganizationType } from '../organization-type.enum';

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /** Regulators read across organization boundaries (proposal section 12). */
  isRegulator(): boolean {
    return this.type === OrganizationType.REGULATOR;
  }
}
