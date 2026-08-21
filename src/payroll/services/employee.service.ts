import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
} from '../dto/employee.dto';
import { Department } from '../entities/department.entity';
import { Employee } from '../entities/employee.entity';
import { EmployeePayItem } from '../entities/employee-pay-item.entity';
import { JobPosition } from '../entities/job-position.entity';

@Injectable()
export class EmployeeService {
  constructor(
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(EmployeePayItem)
    private readonly payItems: Repository<EmployeePayItem>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    @InjectRepository(JobPosition)
    private readonly positions: Repository<JobPosition>,
  ) {}

  async create(
    organization: Organization,
    dto: CreateEmployeeDto,
  ): Promise<Employee> {
    const employeeNumber = `EMP-${randomUUID().slice(0, 8).toUpperCase()}`;
    const [department, position] = await Promise.all([
      dto.departmentId
        ? this.requireDepartment(organization, dto.departmentId)
        : Promise.resolve(null),
      dto.jobPositionId
        ? this.requirePosition(organization, dto.jobPositionId)
        : Promise.resolve(null),
    ]);

    const employee = await this.employees.save(
      this.employees.create({
        organization,
        employeeNumber,
        name: dto.name.trim(),
        department,
        position,
        status: dto.status ?? undefined,
        hireDate: dto.hireDate ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        baseSalary: String(dto.baseSalary),
        overtimeRate: dto.overtimeRate === undefined ? '0' : String(dto.overtimeRate),
      }),
    );

    if (dto.payItems?.length) {
      await this.payItems.save(
        dto.payItems.map((item) =>
          this.payItems.create({
            organization,
            employee,
            name: item.name.trim(),
            type: item.type,
            amount: String(item.amount),
          }),
        ),
      );
    }

    return employee;
  }

  async list(organization: Organization): Promise<Employee[]> {
    return this.employees.find({
      where: { organization: { id: organization.id } },
      order: { name: 'ASC' },
    });
  }

  async get(organization: Organization, employeeId: number): Promise<Employee> {
    const employee = await this.employees.findOne({ where: { id: employeeId } });
    if (!employee || employee.organization.id !== organization.id) {
      throw new NotFoundEntityException('Employee', employeeId);
    }
    return employee;
  }

  async update(
    organization: Organization,
    employeeId: number,
    dto: UpdateEmployeeDto,
  ): Promise<Employee> {
    const employee = await this.get(organization, employeeId);

    if (dto.name !== undefined) employee.name = dto.name.trim();
    if (dto.departmentId !== undefined) {
      employee.department = dto.departmentId
        ? await this.requireDepartment(organization, dto.departmentId)
        : null;
    }
    if (dto.jobPositionId !== undefined) {
      employee.position = dto.jobPositionId
        ? await this.requirePosition(organization, dto.jobPositionId)
        : null;
    }
    if (dto.status !== undefined) employee.status = dto.status;
    if (dto.hireDate !== undefined) employee.hireDate = dto.hireDate ?? null;
    if (dto.phone !== undefined) employee.phone = dto.phone ?? null;
    if (dto.email !== undefined) employee.email = dto.email ?? null;
    if (dto.baseSalary !== undefined) employee.baseSalary = String(dto.baseSalary);
    if (dto.overtimeRate !== undefined) employee.overtimeRate = String(dto.overtimeRate);
    if (dto.active !== undefined) employee.active = dto.active;

    return this.employees.save(employee);
  }

  async payItemsOf(employeeId: number): Promise<EmployeePayItem[]> {
    return this.payItems.find({
      where: { employee: { id: employeeId }, active: true },
      order: { id: 'ASC' },
    });
  }

  async addPayItem(
    organization: Organization,
    employeeId: number,
    name: string,
    type: EmployeePayItem['type'],
    amount: string,
  ): Promise<EmployeePayItem> {
    const employee = await this.get(organization, employeeId);
    return this.payItems.save(
      this.payItems.create({
        organization,
        employee,
        name: name.trim(),
        type,
        amount,
      }),
    );
  }

  async removePayItem(
    organization: Organization,
    employeeId: number,
    payItemId: number,
  ): Promise<void> {
    await this.get(organization, employeeId);
    const item = await this.payItems.findOne({ where: { id: payItemId } });
    if (!item || item.employee.id !== employeeId) {
      throw new NotFoundEntityException('EmployeePayItem', payItemId);
    }
    item.active = false;
    await this.payItems.save(item);
  }

  private async requireDepartment(organization: Organization, id: number) {
    const department = await this.departments.findOne({ where: { id } });
    if (!department || department.organization.id !== organization.id) {
      throw new NotFoundEntityException('Department', id);
    }
    return department;
  }

  private async requirePosition(organization: Organization, id: number) {
    const position = await this.positions.findOne({ where: { id } });
    if (!position || position.organization.id !== organization.id) {
      throw new NotFoundEntityException('JobPosition', id);
    }
    return position;
  }
}