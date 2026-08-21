import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DuplicateException, NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from '../dto/department.dto';
import { Department } from '../entities/department.entity';

@Injectable()
export class DepartmentService {
  constructor(
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
  ) {}

  async create(
    organization: Organization,
    dto: CreateDepartmentDto,
  ): Promise<Department> {
    await this.ensureCodeFree(organization, dto.code);
    return this.departments.save(
      this.departments.create({
        organization,
        code: dto.code.trim(),
        name: dto.name.trim(),
        active: dto.active ?? true,
      }),
    );
  }

  async list(organization: Organization): Promise<Department[]> {
    return this.departments.find({
      where: { organization: { id: organization.id } },
      order: { code: 'ASC' },
    });
  }

  async get(organization: Organization, departmentId: number): Promise<Department> {
    const department = await this.departments.findOne({
      where: { id: departmentId },
    });
    if (!department || department.organization.id !== organization.id) {
      throw new NotFoundEntityException('Department', departmentId);
    }
    return department;
  }

  async update(
    organization: Organization,
    departmentId: number,
    dto: UpdateDepartmentDto,
  ): Promise<Department> {
    const department = await this.get(organization, departmentId);
    if (dto.name !== undefined) department.name = dto.name.trim();
    if (dto.active !== undefined) department.active = dto.active;
    return this.departments.save(department);
  }

  private async ensureCodeFree(organization: Organization, code: string) {
    const existing = await this.departments.findOne({
      where: { organization: { id: organization.id }, code },
    });
    if (existing) {
      throw new DuplicateException(`A department with code ${code} already exists`);
    }
  }
}