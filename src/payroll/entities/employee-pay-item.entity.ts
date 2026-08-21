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
import { PayItemType } from '../payroll.enums';
import { Employee } from './employee.entity';

/**
 * A recurring allowance or deduction attached to one employee (proposal
 * section 8, allowances and deductions): a transport allowance, a housing
 * allowance, a loan repayment, a statutory deduction. Payroll adds up the
 * allowances and subtracts the deductions from the gross.
 */
@Entity('employee_pay_items')
@Index('idx_pay_item_org', ['organization'])
@Index('idx_pay_item_employee', ['employee'])
export class EmployeePayItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Employee, { nullable: false, eager: true })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @Column({ nullable: false })
  name: string;

  @Column({ type: 'enum', enum: PayItemType, nullable: false })
  type: PayItemType;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false })
  amount: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}