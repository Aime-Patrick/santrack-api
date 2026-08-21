import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DuplicateException, NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateVehicleDto, UpdateVehicleDto } from '../dto/vehicle.dto';
import { VehicleType } from '../logistics.enums';
import { Transporter } from '../entities/transporter.entity';
import { Vehicle } from '../entities/vehicle.entity';

@Injectable()
export class VehicleService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Transporter)
    private readonly transporters: Repository<Transporter>,
  ) {}

  async create(
    organization: Organization,
    dto: CreateVehicleDto,
  ): Promise<Vehicle> {
    const transporter = await this.requireTransporter(organization, dto.transporterId);

    const existing = await this.vehicles.findOne({
      where: {
        transporter: { id: transporter.id },
        registrationNumber: dto.registrationNumber.trim(),
      },
    });
    if (existing) {
      throw new DuplicateException(
        `Vehicle ${dto.registrationNumber} is already registered to ${transporter.name}`,
      );
    }

    return this.vehicles.save(
      this.vehicles.create({
        transporter,
        registrationNumber: dto.registrationNumber.trim(),
        type: dto.type ?? VehicleType.TRUCK,
        capacity: dto.capacity === undefined ? null : String(dto.capacity),
        active: dto.active ?? true,
      }),
    );
  }

  async list(organization: Organization): Promise<Vehicle[]> {
    return this.vehicles
      .createQueryBuilder('vehicle')
      .innerJoin('vehicle.transporter', 'transporter')
      .where('transporter.organization_id = :orgId', {
        orgId: organization.id,
      })
      .orderBy('vehicle.registration_number', 'ASC')
      .getMany();
  }

  async get(organization: Organization, vehicleId: number): Promise<Vehicle> {
    const vehicle = await this.vehicles.findOne({ where: { id: vehicleId } });
    if (
      !vehicle ||
      vehicle.transporter.organization.id !== organization.id
    ) {
      throw new NotFoundEntityException('Vehicle', vehicleId);
    }
    return vehicle;
  }

  async update(
    organization: Organization,
    vehicleId: number,
    dto: UpdateVehicleDto,
  ): Promise<Vehicle> {
    const vehicle = await this.get(organization, vehicleId);

    if (dto.registrationNumber !== undefined) {
      vehicle.registrationNumber = dto.registrationNumber.trim();
    }
    if (dto.type !== undefined) vehicle.type = dto.type;
    if (dto.capacity !== undefined) {
      vehicle.capacity = String(dto.capacity);
    }
    if (dto.active !== undefined) vehicle.active = dto.active;

    return this.vehicles.save(vehicle);
  }

  private async requireTransporter(
    organization: Organization,
    transporterId: number,
  ): Promise<Transporter> {
    const transporter = await this.transporters.findOne({
      where: { id: transporterId },
    });
    if (!transporter || transporter.organization.id !== organization.id) {
      throw new NotFoundEntityException('Transporter', transporterId);
    }
    return transporter;
  }
}