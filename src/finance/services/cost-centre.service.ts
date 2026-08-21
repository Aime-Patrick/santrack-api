import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DuplicateException, NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import {
  CreateCostCentreDto,
  UpdateCostCentreDto,
} from '../dto/account.dto';
import { CostCentre } from '../entities/cost-centre.entity';

@Injectable()
export class CostCentreService {
  constructor(
    @InjectRepository(CostCentre)
    private readonly costCentres: Repository<CostCentre>,
  ) {}

  async create(
    organization: Organization,
    dto: CreateCostCentreDto,
  ): Promise<CostCentre> {
    await this.ensureCodeFree(organization, dto.code);
    return this.costCentres.save(
      this.costCentres.create({
        organization,
        code: dto.code.trim(),
        name: dto.name.trim(),
        active: dto.active ?? true,
      }),
    );
  }

  async list(organization: Organization): Promise<CostCentre[]> {
    return this.costCentres.find({
      where: { organization: { id: organization.id } },
      order: { code: 'ASC' },
    });
  }

  async get(organization: Organization, costCentreId: number): Promise<CostCentre> {
    const costCentre = await this.costCentres.findOne({
      where: { id: costCentreId },
    });
    if (!costCentre || costCentre.organization.id !== organization.id) {
      throw new NotFoundEntityException('CostCentre', costCentreId);
    }
    return costCentre;
  }

  async update(
    organization: Organization,
    costCentreId: number,
    dto: UpdateCostCentreDto,
  ): Promise<CostCentre> {
    const costCentre = await this.get(organization, costCentreId);
    if (dto.name !== undefined) costCentre.name = dto.name.trim();
    if (dto.active !== undefined) costCentre.active = dto.active;
    return this.costCentres.save(costCentre);
  }

  private async ensureCodeFree(organization: Organization, code: string) {
    const existing = await this.costCentres.findOne({
      where: { organization: { id: organization.id }, code },
    });
    if (existing) {
      throw new DuplicateException(`A cost centre with code ${code} already exists`);
    }
  }
}