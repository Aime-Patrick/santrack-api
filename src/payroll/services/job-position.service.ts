import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DuplicateException, NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import {
  CreateJobPositionDto,
  UpdateJobPositionDto,
} from '../dto/department.dto';
import { JobPosition } from '../entities/job-position.entity';

@Injectable()
export class JobPositionService {
  constructor(
    @InjectRepository(JobPosition)
    private readonly positions: Repository<JobPosition>,
  ) {}

  async create(
    organization: Organization,
    dto: CreateJobPositionDto,
  ): Promise<JobPosition> {
    await this.ensureCodeFree(organization, dto.code);
    return this.positions.save(
      this.positions.create({
        organization,
        code: dto.code.trim(),
        title: dto.title.trim(),
        active: dto.active ?? true,
      }),
    );
  }

  async list(organization: Organization): Promise<JobPosition[]> {
    return this.positions.find({
      where: { organization: { id: organization.id } },
      order: { code: 'ASC' },
    });
  }

  async get(organization: Organization, positionId: number): Promise<JobPosition> {
    const position = await this.positions.findOne({ where: { id: positionId } });
    if (!position || position.organization.id !== organization.id) {
      throw new NotFoundEntityException('JobPosition', positionId);
    }
    return position;
  }

  async update(
    organization: Organization,
    positionId: number,
    dto: UpdateJobPositionDto,
  ): Promise<JobPosition> {
    const position = await this.get(organization, positionId);
    if (dto.title !== undefined) position.title = dto.title.trim();
    if (dto.active !== undefined) position.active = dto.active;
    return this.positions.save(position);
  }

  private async ensureCodeFree(organization: Organization, code: string) {
    const existing = await this.positions.findOne({
      where: { organization: { id: organization.id }, code },
    });
    if (existing) {
      throw new DuplicateException(`A job position with code ${code} already exists`);
    }
  }
}