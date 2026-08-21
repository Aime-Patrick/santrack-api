import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';

/**
 * An organizational unit an employee belongs to (proposal section 8,
 * departments). Payroll reports roll up by department, so a department that
 * never changes is worth more than a free-text label.
 */
@Entity('departments')
@Unique('uk_department_org_code', ['organization', 'code'])
@Index('idx_department_org', ['organization'])
export class Department {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ nullable: false })
  code: string;

  @Column({ nullable: false })
  name: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}