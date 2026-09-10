import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { NotFoundEntityException } from '../../common/errors';
import { SequenceService } from '../../common/sequence.service';
import { CreateFacilityDto, UpdateFacilityDto } from '../dto/facility.dto';
import { Facility } from '../entities/facility.entity';
import { Organization } from '../entities/organization.entity';

/**
 * The sites a business operates (DR-02, DR-07 WU-1).
 *
 * Until this existed every organization had exactly one site — the one it was
 * given at onboarding — and no way to record a second. That made the
 * multi-plant case unreachable rather than unauthorised: a manufacturer running
 * two plants could not say so, so "which plant made this batch?" had only ever
 * one possible answer.
 *
 * Splitting a business into its real sites is a decision only that business can
 * make, which is why this is a write path they drive and not something the
 * platform infers.
 */
@Injectable()
export class FacilityService {
  constructor(
    @InjectRepository(Facility)
    private readonly facilities: Repository<Facility>,
    private readonly sequences: SequenceService,
  ) {}

  /** Your own sites, open and closed. Another business's premises are not listed. */
  async list(organizationId: number): Promise<Facility[]> {
    return this.facilities.find({
      where: { organizationId },
      order: { id: 'ASC' },
    });
  }

  /**
   * One site, or nothing.
   *
   * Another organization's site is reported as not found rather than
   * forbidden, matching how production already answers the same question: a
   * 403 would confirm that a site with that id exists, which is more than a
   * stranger is entitled to know.
   */
  async get(facilityId: number, organizationId: number): Promise<Facility> {
    const facility = await this.facilities.findOne({ where: { id: facilityId } });
    if (!facility || facility.organizationId !== organizationId) {
      throw new NotFoundEntityException('Facility', facilityId);
    }
    return facility;
  }

  /**
   * Opens a site.
   *
   * Inside a transaction because the code counter takes a pessimistic lock,
   * which Postgres will not grant outside one — and because two people opening
   * a site at the same moment must not be handed the same code.
   */
  async create(
    organization: Organization,
    dto: CreateFacilityDto,
  ): Promise<Facility> {
    return this.facilities.manager.transaction((manager) =>
      this.openWithin(manager, organization, dto.name, dto.address ?? null),
    );
  }

  /**
   * Mints a site inside a transaction the caller already holds.
   *
   * The single place a `FAC-` code is drawn. Onboarding opens a site too, and
   * when it did its own numbering there were two implementations of how a site
   * is created and coded — the kind of split that stays harmless right up until
   * the two drift apart.
   *
   * The manager is passed in rather than opened here because onboarding has
   * other work in the same transaction: an organization that saved but whose
   * site did not would be exactly the orphan DR-02 exists to rule out.
   */
  async openWithin(
    manager: EntityManager,
    organization: Organization,
    name: string,
    address: string | null = null,
  ): Promise<Facility> {
    const sequence = await this.sequences.next(manager, 'FAC');
    return manager.save(
      manager.create(Facility, {
        organization,
        organizationId: organization.id,
        name: name.trim(),
        address: address?.trim() || null,
        code: `FAC-${String(sequence).padStart(6, '0')}`,
      }),
    );
  }

  /**
   * Corrects or closes a site.
   *
   * Closing is a status change, never a delete: batches, production orders,
   * machines and locations reference this row, and a recall that cannot name
   * the plant is not a recall. A closed site stops being selectable for new
   * production and keeps answering for everything already made there.
   */
  async update(
    facilityId: number,
    organizationId: number,
    dto: UpdateFacilityDto,
  ): Promise<Facility> {
    const facility = await this.get(facilityId, organizationId);

    if (dto.name !== undefined) {
      facility.name = dto.name.trim();
    }
    if (dto.address !== undefined) {
      facility.address = dto.address.trim() || null;
    }
    if (dto.active !== undefined) {
      facility.active = dto.active;
    }

    // `code` is deliberately never touched — the entity refuses to update it.
    return this.facilities.save(facility);
  }

  /** Removes all facilities that belong to an organization (used by purge). */
  async deleteFor(organizationId: number): Promise<void> {
    await this.facilities.delete({ organizationId });
  }
}
