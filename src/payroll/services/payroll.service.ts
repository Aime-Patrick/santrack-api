import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { SequenceService } from '../../common/sequence.service';
import { Organization } from '../../organization/entities/organization.entity';
import {
  canPayPayroll,
  computePay,
  EmployeeStatus,
  PayItemType,
  PayrollStatus,
} from '../payroll.enums';
import { CreatePayrollRunDto } from '../dto/payroll.dto';
import { Attendance } from '../entities/attendance.entity';
import { Employee } from '../entities/employee.entity';
import { EmployeePayItem } from '../entities/employee-pay-item.entity';
import { PayrollLine, PayrollRun } from '../entities/payroll.entity';

@Injectable()
export class PayrollService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PayrollRun)
    private readonly runs: Repository<PayrollRun>,
    @InjectRepository(PayrollLine)
    private readonly lines: Repository<PayrollLine>,
    private readonly sequence: SequenceService,
  ) {}

  /**
   * Creates a payroll run for one period. Every active employee gets a line,
   * frozen at the moment of creation: basic salary, allowances, deductions
   * and the period's overtime hours as they stand now (proposal section 8,
   * payroll processing). One run per period - paying it twice would mean two
   * sets of payslips for the same month.
   */
  async create(
    organization: Organization,
    actor: User,
    dto: CreatePayrollRunDto,
  ): Promise<PayrollRun> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(PayrollRun, {
        where: { organization: { id: organization.id }, period: dto.period },
      });
      if (existing) {
        throw new TraceabilityRuleException(
          `A payroll run for ${dto.period} already exists`,
        );
      }

      const employees = await manager.find(Employee, {
        where: { organization: { id: organization.id } },
      });
      const active = employees.filter(
        (employee) =>
          employee.active &&
          employee.status !== EmployeeStatus.TERMINATED,
      );

      const payItems = await manager.find(EmployeePayItem, {
        where: { organization: { id: organization.id }, active: true },
      });
      const itemsByEmployee = new Map<number, EmployeePayItem[]>();
      for (const item of payItems) {
        const list = itemsByEmployee.get(item.employee.id) ?? [];
        list.push(item);
        itemsByEmployee.set(item.employee.id, list);
      }

      const attendance = await manager.find(Attendance, {
        where: { organization: { id: organization.id } },
      });
      const overtimeByEmployee = new Map<number, number>();
      for (const record of attendance) {
        if (!record.attendanceDate.startsWith(dto.period)) continue;
        const current = overtimeByEmployee.get(record.employee.id) ?? 0;
        overtimeByEmployee.set(
          record.employee.id,
          current + parseFloat(record.overtimeHours),
        );
      }

      const runNumber = await this.nextNumber(manager, 'PR');
      const run = await manager.save(
        manager.create(PayrollRun, {
          runNumber,
          organization,
          period: dto.period,
          status: PayrollStatus.DRAFT,
          createdBy: actor,
          paidOn: dto.paidOn ?? null,
        }),
      );

      const payrollLines: Partial<PayrollLine>[] = active.map((employee) => {
        const items = itemsByEmployee.get(employee.id) ?? [];
        const allowances = items
          .filter((item) => item.type === PayItemType.ALLOWANCE)
          .reduce((sum, item) => sum + parseFloat(item.amount), 0);
        const deductions = items
          .filter((item) => item.type === PayItemType.DEDUCTION)
          .reduce((sum, item) => sum + parseFloat(item.amount), 0);
        const overtimeHours = overtimeByEmployee.get(employee.id) ?? 0;
        const pay = computePay({
          baseSalary: parseFloat(employee.baseSalary),
          allowances,
          deductions,
          overtimeHours,
          overtimeRate: parseFloat(employee.overtimeRate),
        });
        return {
          run,
          employee,
          payslipNumber: `PS-${run.runNumber}-${String(employee.id).padStart(4, '0')}`,
          baseSalary: String(pay.baseSalary),
          allowances: String(pay.allowances),
          deductions: String(pay.deductions),
          overtimeHours: String(pay.overtimeHours),
          overtimeAmount: String(pay.overtimeAmount),
          gross: String(pay.gross),
          net: String(pay.net),
        };
      });

      await manager.save(PayrollLine, payrollLines);
      // Through the transaction's manager: the run was written above and is
      // not committed yet, so a repository read on the default connection
      // cannot see it and would fail the whole payroll run.
      return manager.findOneOrFail(PayrollRun, { where: { id: run.id } });
    });
  }

  /** Marks a draft run as paid and freezes its payslips. */
  async pay(organization: Organization, runId: number): Promise<PayrollRun> {
    const run = await this.get(organization, runId);
    if (!canPayPayroll(run.status)) {
      throw new TraceabilityRuleException('Only a draft payroll run can be paid');
    }
    run.status = PayrollStatus.PAID;
    run.paidOn = run.paidOn ?? new Date().toISOString().slice(0, 10);
    return this.runs.save(run);
  }

  async list(organization: Organization): Promise<PayrollRun[]> {
    return this.runs.find({
      where: { organization: { id: organization.id } },
      order: { period: 'DESC', id: 'DESC' },
    });
  }

  async get(organization: Organization, runId: number): Promise<PayrollRun> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run || run.organization.id !== organization.id) {
      throw new NotFoundEntityException('PayrollRun', runId);
    }
    return run;
  }

  async linesOf(runId: number): Promise<PayrollLine[]> {
    return this.lines.find({
      where: { run: { id: runId } },
      order: { id: 'ASC' },
    });
  }

  private async nextNumber(manager: EntityManager, prefix: string): Promise<string> {
    const value = await this.sequence.next(manager, prefix);
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
}