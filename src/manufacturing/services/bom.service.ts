import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { CreateBomDto } from '../dto/bom.dto';
import {
  BillOfMaterial,
  BillOfMaterialLine,
} from '../entities/bill-of-material.entity';
import { RawMaterial } from '../entities/raw-material.entity';

@Injectable()
export class BomService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(BillOfMaterial)
    private readonly boms: Repository<BillOfMaterial>,
    @InjectRepository(BillOfMaterialLine)
    private readonly lines: Repository<BillOfMaterialLine>,
    @InjectRepository(RawMaterial)
    private readonly materials: Repository<RawMaterial>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  /**
   * Creates a new recipe and retires any current one for the same product.
   * Past production keeps pointing at the recipe it actually used, because the
   * old rows are deactivated, never deleted or overwritten.
   */
  async create(organization: Organization, dto: CreateBomDto): Promise<BillOfMaterial> {
    const product = await this.products.findOne({ where: { id: dto.productId } });
    if (!product) {
      throw new NotFoundEntityException('Product', dto.productId);
    }

    for (const line of dto.lines) {
      const material = await this.materials.findOne({
        where: { id: line.materialId },
      });
      if (!material || material.organization.id !== organization.id) {
        throw new NotFoundEntityException('Raw material', line.materialId);
      }
      if (Number(line.quantityPerUnit) <= 0) {
        throw new TraceabilityRuleException(
          'quantityPerUnit must be greater than zero',
        );
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const previous = await manager.findOne(BillOfMaterial, {
        where: { organization: { id: organization.id }, product: { id: product.id } },
        order: { version: 'DESC' },
      });
      const version = (previous?.version ?? 0) + 1;

      await manager.update(
        BillOfMaterial,
        {
          organization: { id: organization.id },
          product: { id: product.id },
          active: true,
        },
        { active: false },
      );

      const bom = await manager.save(
        manager.create(BillOfMaterial, {
          organization,
          product,
          name: dto.name ?? null,
          version,
          active: true,
        }),
      );

      for (const line of dto.lines) {
        await manager.save(
          manager.create(BillOfMaterialLine, {
            bom,
            material: { id: line.materialId } as RawMaterial,
            quantityPerUnit: String(line.quantityPerUnit),
            wastagePercent: String(line.wastagePercent ?? 0),
          }),
        );
      }

      return bom;
    });
  }

  async list(organization: Organization): Promise<BillOfMaterial[]> {
    return this.boms.find({
      where: { organization: { id: organization.id } },
      order: { id: 'DESC' },
    });
  }

  async get(organization: Organization, bomId: number): Promise<BillOfMaterial> {
    const bom = await this.boms.findOne({ where: { id: bomId } });
    if (!bom || bom.organization.id !== organization.id) {
      throw new NotFoundEntityException('BOM', bomId);
    }
    return bom;
  }

  async linesOf(bomId: number): Promise<BillOfMaterialLine[]> {
    return this.lines.find({
      where: { bom: { id: bomId } },
      order: { id: 'ASC' },
    });
  }
}
