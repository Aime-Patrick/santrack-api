import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { PayrollLine, PayrollRun } from '../entities/payroll.entity';
import { Leave } from '../entities/leave.entity';

@Injectable()
export class PayrollReportService {
  constructor(
    @InjectRepository(PayrollLine)
    private readonly lines: Repository<PayrollLine>,
    @InjectRepository(PayrollRun)
    private readonly runs: Repository<PayrollRun>,
    @InjectRepository(Leave)
    private readonly leaves: Repository<Leave>,
  ) {}

  /**
   * Payroll summary for one run or one period (proposal section 8, payroll
   * reports): totals by department, with the grand total the finance module
   * will post as the salary expense.
   */
  async summary(organization: Organization, runId?: number, period?: string) {
    const runs = runId
      ? [await this.requireRun(organization, runId)]
      : period
        ? await this.runs.find({
            where: { organization: { id: organization.id }, period },
          })
        : await this.runs.find({
            where: { organization: { id: organization.id } },
          });

    const byDepartment = new Map<
      number,
      {
        departmentId: number;
        departmentName: string;
        employees: number;
        baseSalary: number;
        allowances: number;
        deductions: number;
        overtime: number;
        gross: number;
        net: number;
      }
    >();

    for (const run of runs) {
      const lines = await this.lines.find({
        where: { run: { id: run.id } },
        relations: { employee: { department: true } },
      });
      for (const line of lines) {
        const deptId = line.employee.department?.id ?? 0;
        const bucket = byDepartment.get(deptId) ?? {
          departmentId: deptId,
          departmentName: line.employee.department?.name ?? 'Unassigned',
          employees: 0,
          baseSalary: 0,
          allowances: 0,
          deductions: 0,
          overtime: 0,
          gross: 0,
          net: 0,
        };
        bucket.employees += 1;
        bucket.baseSalary += parseFloat(line.baseSalary);
        bucket.allowances += parseFloat(line.allowances);
        bucket.deductions += parseFloat(line.deductions);
        bucket.overtime += parseFloat(line.overtimeAmount);
        bucket.gross += parseFloat(line.gross);
        bucket.net += parseFloat(line.net);
        byDepartment.set(deptId, bucket);
      }
    }

    const departments = [...byDepartment.values()]
      .map((row) => ({
        departmentId: row.departmentId,
        departmentName: row.departmentName,
        employees: row.employees,
        baseSalary: round2(row.baseSalary),
        allowances: round2(row.allowances),
        deductions: round2(row.deductions),
        overtime: round2(row.overtime),
        gross: round2(row.gross),
        net: round2(row.net),
      }))
      .sort((a, b) => (a.departmentName < b.departmentName ? -1 : 1));

    const totals = departments.reduce(
      (sum, row) => {
        sum.employees += row.employees;
        sum.baseSalary += row.baseSalary;
        sum.allowances += row.allowances;
        sum.deductions += row.deductions;
        sum.overtime += row.overtime;
        sum.gross += row.gross;
        sum.net += row.net;
        return sum;
      },
      {
        employees: 0,
        baseSalary: 0,
        allowances: 0,
        deductions: 0,
        overtime: 0,
        gross: 0,
        net: 0,
      },
    );
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      if (key !== 'employees') totals[key] = round2(totals[key]);
    }

    return {
      runs: runs.length,
      period: period ?? (runId ? undefined : 'all'),
      departments,
      totals,
    };
  }

  /** Leave taken and outstanding per employee (proposal section 8). */
  async leaveReport(organization: Organization) {
    const leaves = await this.leaves.find({
      where: { organization: { id: organization.id } },
      relations: { employee: true },
    });
    const approved = leaves.filter((leave) => leave.status === 'APPROVED');
    const byEmployee = new Map<
      number,
      { employeeId: number; employeeName: string; days: number }
    >();
    for (const leave of approved) {
      const row = byEmployee.get(leave.employee.id) ?? {
        employeeId: leave.employee.id,
        employeeName: leave.employee.name,
        days: 0,
      };
      row.days += leave.days;
      byEmployee.set(leave.employee.id, row);
    }
    return {
      totalApprovedDays: approved.reduce((sum, leave) => sum + leave.days, 0),
      employees: [...byEmployee.values()].sort((a, b) =>
        a.employeeName < b.employeeName ? -1 : 1,
      ),
    };
  }

  private async requireRun(organization: Organization, runId: number): Promise<PayrollRun> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run || run.organization.id !== organization.id) {
      throw new NotFoundEntityException('PayrollRun', runId);
    }
    return run;
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}