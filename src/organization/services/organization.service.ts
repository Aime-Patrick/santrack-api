import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import {
  DuplicateException,
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { LicenseService } from '../../licensing/services/license.service';
import { Product } from '../../product/entities/product.entity';
import { CreateOrganizationDto } from '../dto/organization.dto';
import {
  OrganizationType,
  SELF_DECLARABLE_TYPES,
  isSelfDeclarable,
} from '../organization-type.enum';
import { Facility } from '../entities/facility.entity';
import { Organization } from '../entities/organization.entity';
import { FacilityService } from './facility.service';

/** One business as the industry registry reports it. */
export interface RegistryEntry {
  organization: Organization;
  staff: number;
  products: number;
  licenses: {
    licenseNumber: string;
    activity: string;
    status: string;
    expiresOn: string | Date | null;
  }[];
}

@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Facility)
    private readonly facilities: Repository<Facility>,
    private readonly sites: FacilityService,
    private readonly licenses: LicenseService,
    config: ConfigService,
  ) {
    this.provisionalDays = config.get<number>('licensing.provisionalDays') ?? 90;
  }

  private readonly provisionalDays: number;

  /**
   * Onboarding: the caller creates the business they act for and is attached
   * to it. One organization per user - a person who moves between businesses
   * gets a new account there, because the chain of custody records which
   * business acted, and an ambiguous actor would undermine that.
   */
  async create(actor: User, dto: CreateOrganizationDto): Promise<Organization> {
    if (actor.organization) {
      throw new TraceabilityRuleException(
        `You already act for ${actor.organization.name}`,
      );
    }

    // Belt and braces: the DTO already rejects non-self-declarable types, but
    // this is the boundary that actually matters, so it does not rely on a
    // validator staying correct.
    if (!isSelfDeclarable(dto.type)) {
      throw new TraceabilityRuleException(
        `${dto.type} standing is granted by the platform, not chosen at sign-up`,
      );
    }

    const name = dto.name.trim();
    if (await this.organizations.findOne({ where: { name } })) {
      throw new DuplicateException(`An organization named ${name} already exists`);
    }

    const organization = await this.organizations.save(
      this.organizations.create({ name, type: dto.type }),
    );

    /**
     * Every organization gets a site (DR-02).
     *
     * The migration backfilled one for each business that already existed, and
     * without this new ones would be the only organizations that could not
     * answer "which facility produced this batch?" — the guarantee would hold
     * for historic data and quietly lapse for everything created afterwards.
     *
     * Named after the organization, the same way the backfill named them, so a
     * single-site business never has to think about it.
     */
    // Inside a transaction because the code counter takes a pessimistic lock,
    // which Postgres will not grant outside one - and because two people
    // onboarding at the same moment must not be handed the same site code.
    //
    // The site itself is minted by FacilityService, which is also what the
    // facilities endpoint calls. Onboarding used to draw its own FAC- number
    // inline, so there were two implementations of how a site is created and
    // coded; they agreed, until they would not have.
    await this.facilities.manager.transaction((manager) =>
      this.sites.openWithin(manager, organization, `${name} — main site`),
    );

    actor.organization = organization;
    await this.users.save(actor);

    /**
     * Same grace period the licensing migration gave every business that
     * already existed. Without it the migration's cut-off leaks into normal
     * operation: everyone onboarded before that date trades on a provisional
     * licence while everyone who signs up afterwards is non-compliant from
     * their first action, which is an accident of timing rather than a rule
     * anyone chose.
     *
     * Deliberately not awaited into the failure path - a licensing problem
     * must not cost someone their organization, which is already saved above.
     */
    await this.licenses.issueProvisional(organization, this.provisionalDays);

    return organization;
  }

  /**
   * The directory of trading partners: who you can dispatch to or sell to.
   * Names and types only - never another organization's stock or history.
   *
   * `types` narrows it. The unfiltered list mixes oversight bodies in with
   * businesses, which is wrong in both directions: a regulator is not somebody
   * you dispatch stock to, and a page about regulators should not be showing
   * every shop on the platform. Filtering here rather than in the browser
   * keeps the payload proportionate to what the caller asked for.
   */
  async list(types?: OrganizationType[]): Promise<Organization[]> {
    return this.organizations.find({
      where: types && types.length > 0 ? { type: In(types) } : {},
      order: { name: 'ASC' },
    });
  }

  /**
   * The supervisory view of the businesses on the platform: who is registered,
   * how many people work there, how much catalogue they carry, and where their
   * licences stand.
   *
   * Deliberately not the same call as `list`. That one answers "who can I
   * dispatch to?" and every signed-in user needs it; this one answers "who is
   * operating in this industry and are they compliant?", which proposal
   * section 3 places with the licensing authorities and the platform operator.
   * Two questions, two capabilities - and the trading-partner picker does not
   * become a back door into the register.
   *
   * Oversight bodies are excluded: a regulator is an authority, not an
   * industry, and listing the authorities among the businesses they supervise
   * is what `listRegulators` is for.
   */
  async registry(): Promise<RegistryEntry[]> {
    const businesses = await this.organizations.find({
      where: { type: In(SELF_DECLARABLE_TYPES as OrganizationType[]) },
      order: { name: 'ASC' },
    });

    return Promise.all(
      businesses.map(async (organization) => {
        const licenses = await this.licenses.listFor(organization);
        return {
          organization,
          staff: await this.users.count({
            where: { organization: { id: organization.id } },
          }),
          products: await this.products.count({
            where: { organizationId: organization.id },
          }),
          licenses: licenses.map((license) => ({
            licenseNumber: license.licenseNumber,
            activity: license.category.activity,
            status: license.status,
            expiresOn: license.expiresOn,
          })),
        };
      }),
    );
  }

  /**
   * Corrects a registry entry. Platform operators only.
   *
   * Type changes are restricted to the business types: moving an organization
   * into or out of REGULATOR is granting or withdrawing standing, which has
   * its own routes because it carries consequences a rename does not.
   */
  async amend(
    organizationId: number,
    changes: { name?: string; type?: OrganizationType },
  ): Promise<Organization> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', organizationId);
    }

    if (changes.type && changes.type !== organization.type) {
      if (organization.type === OrganizationType.REGULATOR) {
        throw new TraceabilityRuleException(
          `${organization.name} holds regulatory standing; withdraw it before changing its type`,
        );
      }
      if (!isSelfDeclarable(changes.type)) {
        throw new TraceabilityRuleException(
          `${changes.type} standing is granted by the platform, not set by editing the registry`,
        );
      }
      organization.type = changes.type;
    }

    if (changes.name) {
      const name = changes.name.trim();
      const clash = await this.organizations.findOne({ where: { name } });
      if (clash && clash.id !== organization.id) {
        throw new DuplicateException(
          `An organization named ${name} already exists`,
        );
      }
      organization.name = name;
    }

    return this.organizations.save(organization);
  }

  /**
   * Registers an oversight body. Platform operators only, for the same reason
   * `grantRegulatoryStanding` is: this organization will read every timeline
   * on the platform and can recall any manufacturer's batch.
   *
   * Unlike onboarding, the caller is not attached to it. The operator standing
   * up a regulator is not joining that regulator, and staff arrive afterwards
   * through user management.
   *
   * No provisional licence is issued either. Licensing governs who may trade;
   * an authority does not trade, and giving it a licence to lapse would put a
   * compliance finding against the body that reads them.
   */
  async registerRegulator(name: string): Promise<Organization> {
    const trimmed = name.trim();
    if (await this.organizations.findOne({ where: { name: trimmed } })) {
      throw new DuplicateException(`An organization named ${trimmed} already exists`);
    }

    return this.organizations.save(
      this.organizations.create({ name: trimmed, type: OrganizationType.REGULATOR }),
    );
  }

  /** Every organization holding regulatory standing, with its staff count. */
  async listRegulators(): Promise<{ organization: Organization; staff: number }[]> {
    const regulators = await this.organizations.find({
      where: { type: OrganizationType.REGULATOR },
      order: { name: 'ASC' },
    });

    return Promise.all(
      regulators.map(async (organization) => ({
        organization,
        staff: await this.users.count({
          where: { organization: { id: organization.id } },
        }),
      })),
    );
  }

  /**
   * Withdraws regulatory standing, returning the organization to an ordinary
   * business type.
   *
   * Standing is the type, so withdrawing it has to say what the organization
   * becomes - see `RevokeRegulatoryStandingDto`. A body registered as a
   * regulator from the start has no earlier business identity to return to,
   * and reverting it leaves a business record nobody registered; that is the
   * operator's call to make knowingly, which is why the target is stated
   * rather than inferred.
   */
  async revokeRegulatoryStanding(
    organizationId: number,
    revertTo: OrganizationType,
  ): Promise<Organization> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', organizationId);
    }
    if (organization.type !== OrganizationType.REGULATOR) {
      throw new TraceabilityRuleException(
        `${organization.name} is a ${organization.type} and holds no regulatory standing`,
      );
    }
    if (!isSelfDeclarable(revertTo)) {
      throw new TraceabilityRuleException(
        `${revertTo} is not a business type an organization can hold`,
      );
    }

    organization.type = revertTo;
    return this.organizations.save(organization);
  }

  /**
   * Confers regulatory standing on an organization. Reserved to the platform
   * operator, because a regulator reads every timeline on the platform,
   * sees consumer information and can recall any manufacturer's batch.
   *
   * This is the bootstrap for the regulatory layer: the first regulator has to
   * be granted by someone already trusted, since there is no regulator yet to
   * approve them. Once the licensing module lands, this becomes the narrow
   * path used only to seed the first authority - everyone else arrives through
   * an application that a regulator reviews.
   */
  async grantRegulatoryStanding(organizationId: number): Promise<Organization> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', organizationId);
    }

    organization.type = OrganizationType.REGULATOR;
    return this.organizations.save(organization);
  }
}
