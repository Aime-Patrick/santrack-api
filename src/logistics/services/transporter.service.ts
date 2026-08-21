import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { DuplicateException, NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import {
  CreateTransporterDto,
  UpdateTransporterDto,
} from '../dto/transporter.dto';
import { Transporter } from '../entities/transporter.entity';

@Injectable()
export class TransporterService {
  constructor(
    @InjectRepository(Transporter)
    private readonly transporters: Repository<Transporter>,
  ) {}

  async create(
    organization: Organization,
    dto: CreateTransporterDto,
  ): Promise<Transporter> {
    const code = dto.code?.trim() || generateCode();

    const existing = await this.transporters.findOne({
      where: { organization: { id: organization.id }, code },
    });
    if (existing) {
      throw new DuplicateException(`A transporter with code ${code} already exists`);
    }

    return this.transporters.save(
      this.transporters.create({
        organization,
        name: dto.name.trim(),
        code,
        contactPerson: dto.contactPerson ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        active: dto.active ?? true,
      }),
    );
  }

  async list(organization: Organization): Promise<Transporter[]> {
    return this.transporters.find({
      where: { organization: { id: organization.id } },
      order: { name: 'ASC' },
    });
  }

  /** Transporters are private to an organization; ownership is enforced. */
  async get(organization: Organization, transporterId: number): Promise<Transporter> {
    const transporter = await this.transporters.findOne({
      where: { id: transporterId },
    });
    if (!transporter || transporter.organization.id !== organization.id) {
      throw new NotFoundEntityException('Transporter', transporterId);
    }
    return transporter;
  }

  async update(
    organization: Organization,
    transporterId: number,
    dto: UpdateTransporterDto,
  ): Promise<Transporter> {
    const transporter = await this.get(organization, transporterId);

    if (dto.name !== undefined) transporter.name = dto.name.trim();
    if (dto.contactPerson !== undefined) transporter.contactPerson = dto.contactPerson ?? null;
    if (dto.phone !== undefined) transporter.phone = dto.phone ?? null;
    if (dto.email !== undefined) transporter.email = dto.email ?? null;
    if (dto.active !== undefined) transporter.active = dto.active;

    return this.transporters.save(transporter);
  }
}

function generateCode(): string {
  return `TR-${randomUUID().slice(0, 8).toUpperCase()}`;
}