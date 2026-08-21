import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DuplicateException, NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateDriverDto, UpdateDriverDto } from '../dto/driver.dto';
import { Driver } from '../entities/driver.entity';
import { Transporter } from '../entities/transporter.entity';

@Injectable()
export class DriverService {
  constructor(
    @InjectRepository(Driver)
    private readonly drivers: Repository<Driver>,
    @InjectRepository(Transporter)
    private readonly transporters: Repository<Transporter>,
  ) {}

  async create(organization: Organization, dto: CreateDriverDto): Promise<Driver> {
    const transporter = await this.requireTransporter(organization, dto.transporterId);

    const licenseNumber = dto.licenseNumber?.trim() ?? null;
    if (licenseNumber) {
      const existing = await this.drivers.findOne({
        where: { transporter: { id: transporter.id }, licenseNumber },
      });
      if (existing) {
        throw new DuplicateException(
          `A driver with licence ${licenseNumber} is already registered to ${transporter.name}`,
        );
      }
    }

    return this.drivers.save(
      this.drivers.create({
        transporter,
        name: dto.name.trim(),
        licenseNumber,
        phone: dto.phone ?? null,
        active: dto.active ?? true,
      }),
    );
  }

  async list(organization: Organization): Promise<Driver[]> {
    return this.drivers
      .createQueryBuilder('driver')
      .innerJoin('driver.transporter', 'transporter')
      .where('transporter.organization_id = :orgId', {
        orgId: organization.id,
      })
      .orderBy('driver.name', 'ASC')
      .getMany();
  }

  async get(organization: Organization, driverId: number): Promise<Driver> {
    const driver = await this.drivers.findOne({ where: { id: driverId } });
    if (!driver || driver.transporter.organization.id !== organization.id) {
      throw new NotFoundEntityException('Driver', driverId);
    }
    return driver;
  }

  async update(
    organization: Organization,
    driverId: number,
    dto: UpdateDriverDto,
  ): Promise<Driver> {
    const driver = await this.get(organization, driverId);

    if (dto.name !== undefined) driver.name = dto.name.trim();
    if (dto.licenseNumber !== undefined) driver.licenseNumber = dto.licenseNumber.trim() || null;
    if (dto.phone !== undefined) driver.phone = dto.phone ?? null;
    if (dto.active !== undefined) driver.active = dto.active;

    return this.drivers.save(driver);
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