import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { SequenceService } from '../../common/sequence.service';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateLocationDto } from '../dto/location.dto';
import { Location } from '../entities/location.entity';

@Injectable()
export class LocationService {
  constructor(
    @InjectRepository(Location)
    private readonly locations: Repository<Location>,
    private readonly sequences: SequenceService,
  ) {}

  /**
   * Registers a place and mints the code that goes on its label.
   *
   * The code is generated rather than typed: it exists to be printed onto a
   * bay and scanned, so nobody needs to choose it, and letting two people
   * choose the same one would make a scan ambiguous.
   */
  async create(
    organization: Organization,
    dto: CreateLocationDto,
  ): Promise<Location> {
    return this.locations.manager.transaction(async (manager) => {
      const code = await this.sequences.next(manager, 'LOC');
      return manager.save(
        manager.create(Location, {
          organization,
          name: dto.name.trim(),
          code: `LOC-${String(code).padStart(6, '0')}`,
          type: dto.type,
          address: dto.address ?? null,
          active: true,
        }),
      );
    });
  }

  async update(
    organization: Organization,
    locationId: number,
    dto: CreateLocationDto,
  ): Promise<Location> {
    const location = await this.requireOwned(organization, locationId);
    const name = dto.name.trim();

    if (name !== location.name) {
      const clash = await this.locations.findOne({
        where: { organization: { id: organization.id }, name },
      });
      if (clash) {
        throw new TraceabilityRuleException(
          `A location named '${name}' already exists for this organization`,
        );
      }
    }

    location.name = name;
    location.type = dto.type;
    location.address = dto.address ?? null;
    return this.locations.save(location);
  }

  /** Only ever the caller's own locations. */
  async list(organization: Organization): Promise<Location[]> {
    return this.locations.find({
      where: { organization: { id: organization.id } },
      order: { name: 'ASC' },
    });
  }

  async requireOwned(
    organization: Organization,
    locationId: number,
  ): Promise<Location> {
    const location = await this.locations.findOne({ where: { id: locationId } });
    if (!location) {
      throw new NotFoundEntityException('Location', locationId);
    }
    if (location.organization.id !== organization.id) {
      throw new TraceabilityRuleException(
        `Location ${locationId} does not belong to ${organization.name}`,
      );
    }
    return location;
  }
}
