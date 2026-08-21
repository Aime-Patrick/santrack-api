import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { DuplicateException, NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateRawMaterialDto } from '../dto/raw-material.dto';
import { RawMaterial } from '../entities/raw-material.entity';

@Injectable()
export class RawMaterialService {
  constructor(
    @InjectRepository(RawMaterial)
    private readonly materials: Repository<RawMaterial>,
  ) {}

  async create(organization: Organization, dto: CreateRawMaterialDto): Promise<RawMaterial> {
    const code = dto.code?.trim() || generateCode();

    const existing = await this.materials.findOne({
      where: { organization: { id: organization.id }, code },
    });
    if (existing) {
      throw new DuplicateException(
        `A raw material with code ${code} already exists`,
      );
    }

    return this.materials.save(
      this.materials.create({
        organization,
        name: dto.name.trim(),
        code,
        category: dto.category ?? null,
        unitOfMeasure: dto.unitOfMeasure.trim(),
        unitCost: dto.unitCost === undefined ? '0' : String(dto.unitCost),
        reorderLevel: dto.reorderLevel === undefined ? '0' : String(dto.reorderLevel),
      }),
    );
  }

  async list(organization: Organization): Promise<RawMaterial[]> {
    return this.materials.find({
      where: { organization: { id: organization.id } },
      order: { name: 'ASC' },
    });
  }

  /** Materials are private to an organization; ownership is enforced. */
  async get(organization: Organization, materialId: number): Promise<RawMaterial> {
    const material = await this.materials.findOne({ where: { id: materialId } });
    if (!material || material.organization.id !== organization.id) {
      throw new NotFoundEntityException('Raw material', materialId);
    }
    return material;
  }
}

function generateCode(): string {
  return `RM-${randomUUID().slice(0, 8).toUpperCase()}`;
}
