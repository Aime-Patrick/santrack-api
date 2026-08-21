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
import { AttendanceStatus } from '../payroll.enums';
import { Employee } from './employee.entity';

/**
 * One day of attendance for one employee (proposal section 8, attendance).
 * Overtime hours accumulate on the day they were worked, and the payroll run
 * multiplies the period's total by the employee's overtime rate.
 */
@Entity('attendance')
@Unique('uk_attendance_employee_date', ['employee', 'attendanceDate'])
@Index('idx_attendance_org', ['organization'])
@Index('idx_attendance_employee', ['employee'])
export class Attendance {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Employee, { nullable: false, eager: true })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @Column({ name: 'attendance_date', type: 'date', nullable: false })
  attendanceDate: string;

  @Column({ type: 'enum', enum: AttendanceStatus, default: AttendanceStatus.PRESENT })
  status: AttendanceStatus;

  @Column({ name: 'overtime_hours', type: 'numeric', precision: 6, scale: 2, nullable: false, default: '0' })
  overtimeHours: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}