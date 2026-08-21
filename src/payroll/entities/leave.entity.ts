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
import { LeaveStatus, LeaveType } from '../payroll.enums';
import { Employee } from './employee.entity';

/**
 * A leave request (proposal section 8, leave). A request starts REQUESTED and
 * is approved or rejected; only an approved leave counts as a paid day.
 */
@Entity('leaves')
@Index('idx_leave_org', ['organization'])
@Index('idx_leave_employee', ['employee'])
export class Leave {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Employee, { nullable: false, eager: true })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @Column({ type: 'enum', enum: LeaveType, nullable: false })
  type: LeaveType;

  @Column({ name: 'from_date', type: 'date', nullable: false })
  fromDate: string;

  @Column({ name: 'to_date', type: 'date', nullable: false })
  toDate: string;

  @Column({ type: 'integer', nullable: false })
  days: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  reason: string | null;

  @Column({ type: 'enum', enum: LeaveStatus, default: LeaveStatus.REQUESTED })
  status: LeaveStatus;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by_id' })
  approvedBy: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}