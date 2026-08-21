import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { DuplicateException, NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateRouteDto, UpdateRouteDto } from '../dto/route.dto';
import { Route } from '../entities/route.entity';

@Injectable()
export class RouteService {
  constructor(
    @InjectRepository(Route)
    private readonly routes: Repository<Route>,
  ) {}

  async create(organization: Organization, dto: CreateRouteDto): Promise<Route> {
    if (dto.sourceLocationId === dto.destinationLocationId) {
      throw new TraceabilityRuleException(
        'A route cannot start and end at the same location',
      );
    }

    const existing = await this.routes.findOne({
      where: {
        organization: { id: organization.id },
        name: dto.name.trim(),
      },
    });
    if (existing) {
      throw new DuplicateException(`A route named ${dto.name} already exists`);
    }

    const sourceLocation = await this.requireOwnedLocation(
      organization,
      dto.sourceLocationId,
    );
    const destinationLocation = await this.requireOwnedLocation(
      organization,
      dto.destinationLocationId,
    );

    return this.routes.save(
      this.routes.create({
        organization,
        name: dto.name.trim(),
        sourceLocation,
        destinationLocation,
        distanceKm: dto.distanceKm === undefined ? null : String(dto.distanceKm),
        expectedHours: dto.expectedHours === undefined ? null : String(dto.expectedHours),
        active: dto.active ?? true,
      }),
    );
  }

  async list(organization: Organization): Promise<Route[]> {
    return this.routes.find({
      where: { organization: { id: organization.id } },
      order: { name: 'ASC' },
    });
  }

  /** Routes are private to an organization; ownership is enforced. */
  async get(organization: Organization, routeId: number): Promise<Route> {
    const route = await this.routes.findOne({ where: { id: routeId } });
    if (!route || route.organization.id !== organization.id) {
      throw new NotFoundEntityException('Route', routeId);
    }
    return route;
  }

  async update(
    organization: Organization,
    routeId: number,
    dto: UpdateRouteDto,
  ): Promise<Route> {
    const route = await this.get(organization, routeId);

    const sourceId = dto.sourceLocationId ?? route.sourceLocation.id;
    const destinationId =
      dto.destinationLocationId ?? route.destinationLocation.id;
    if (sourceId === destinationId) {
      throw new TraceabilityRuleException(
        'A route cannot start and end at the same location',
      );
    }

    if (dto.name !== undefined) route.name = dto.name.trim();
    if (dto.sourceLocationId !== undefined) {
      route.sourceLocation = await this.requireOwnedLocation(
        organization,
        dto.sourceLocationId,
      );
    }
    if (dto.destinationLocationId !== undefined) {
      route.destinationLocation = await this.requireOwnedLocation(
        organization,
        dto.destinationLocationId,
      );
    }
    if (dto.distanceKm !== undefined) {
      route.distanceKm = dto.distanceKm === null ? null : String(dto.distanceKm);
    }
    if (dto.expectedHours !== undefined) {
      route.expectedHours = dto.expectedHours === null ? null : String(dto.expectedHours);
    }
    if (dto.active !== undefined) route.active = dto.active;

    return this.routes.save(route);
  }

  private async requireOwnedLocation(
    organization: Organization,
    locationId: number,
  ): Promise<Location> {
    const location = await this.routes.manager.findOne(Location, {
      where: { id: locationId },
    });
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