import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { DuplicateException, NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateMachineDto } from '../dto/machine.dto';
import { Machine } from '../entities/machine.entity';
import { MachineStatus } from '../manufacturing.enums';

@Injectable()
export class MachineService {
  constructor(
    @InjectRepository(Machine)
    private readonly machines: Repository<Machine>,
  ) {}

  async create(organization: Organization, dto: CreateMachineDto): Promise<Machine> {
    const code = dto.code?.trim() || generateCode();

    const existing = await this.machines.findOne({
      where: { organization: { id: organization.id }, code },
    });
    if (existing) {
      throw new DuplicateException(`A machine with code ${code} already exists`);
    }

    return this.machines.save(
      this.machines.create({
        organization,
        code,
        name: dto.name.trim(),
        type: dto.type ?? null,
        status: MachineStatus.ACTIVE,
      }),
    );
  }

  async list(organization: Organization): Promise<Machine[]> {
    return this.machines.find({
      where: { organization: { id: organization.id } },
      order: { name: 'ASC' },
    });
  }

  async get(organization: Organization, machineId: number): Promise<Machine> {
    const machine = await this.machines.findOne({ where: { id: machineId } });
    if (!machine || machine.organization.id !== organization.id) {
      throw new NotFoundEntityException('Machine', machineId);
    }
    return machine;
  }
}

function generateCode(): string {
  return `MC-${randomUUID().slice(0, 8).toUpperCase()}`;
}
