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
import { EmployeeStatus } from '../payroll.enums';
import { Department } from './department.entity';
import { JobPosition } from './job-position.entity';

/**
 * An employee on the payroll (proposal section 8, employee registration).
 * The number is a stable identity; the department, position, status and basic
 * salary are the raw material a payroll run computes from.
 */
@Entity('employees')
@Unique('uk_employee_org_number', ['organization', 'employeeNumber'])
@Index('idx_employee_org', ['organization'])
@Index('idx_employee_department', ['department'])
export class Employee {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'employee_number', nullable: false })
  employeeNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ nullable: false })
  name: string;

  @ManyToOne(() => Department, { nullable: true, eager: true })
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  @ManyToOne(() => JobPosition, { nullable: true, eager: true })
  @JoinColumn({ name: 'job_position_id' })
  position: JobPosition | null;

  @Column({ type: 'enum', enum: EmployeeStatus, default: EmployeeStatus.ACTIVE })
  status: EmployeeStatus;

  @Column({ name: 'hire_date', type: 'date', nullable: true })
  hireDate: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  /** Monthly basic salary, before allowances, overtime and deductions. */
  @Column({ name: 'base_salary', type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  baseSalary: string;

  /** Overtime pay per hour (proposal section 8, overtime). */
  @Column({ name: 'overtime_rate', type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  overtimeRate: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}