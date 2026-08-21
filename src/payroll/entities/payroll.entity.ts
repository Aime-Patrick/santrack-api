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
import { PayrollStatus } from '../payroll.enums';
import { Employee } from './employee.entity';

/**
 * A monthly payroll run (proposal section 8, payroll processing). The run is
 * a snapshot for one period: it captures basic salary, pay items, overtime
 * and attendance as they were when the run was created, so paying it later
 * does not let a change to an employee's salary rewrite the run.
 */
@Entity('payroll_runs')
@Index('idx_payroll_org', ['organization'])
@Index('idx_payroll_period', ['period'])
export class PayrollRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'run_number', nullable: false })
  runNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ nullable: false })
  period: string;

  @Column({ type: 'enum', enum: PayrollStatus, default: PayrollStatus.DRAFT })
  status: PayrollStatus;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @Column({ name: 'paid_on', type: 'date', nullable: true })
  paidOn: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

/**
 * One employee's payslip inside a payroll run (proposal section 8,
 * payslips). The run's arithmetic - base salary, allowances, overtime,
 * deductions, gross and net - is frozen here so a payslip always states what
 * it stated on the day the run was paid.
 */
@Entity('payroll_lines')
@Index('idx_payroll_line_run', ['run'])
@Index('idx_payroll_line_employee', ['employee'])
export class PayrollLine {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PayrollRun, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: PayrollRun;

  @ManyToOne(() => Employee, { nullable: false, eager: true })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @Column({ name: 'payslip_number', nullable: false })
  payslipNumber: string;

  @Column({ name: 'base_salary', type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  baseSalary: string;

  @Column({ name: 'allowances', type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  allowances: string;

  @Column({ name: 'deductions', type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  deductions: string;

  @Column({ name: 'overtime_hours', type: 'numeric', precision: 6, scale: 2, nullable: false, default: '0' })
  overtimeHours: string;

  @Column({ name: 'overtime_amount', type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  overtimeAmount: string;

  @Column({ name: 'gross', type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  gross: string;

  @Column({ name: 'net', type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  net: string;
}