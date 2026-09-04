import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { today } from '../../item/entities/traceable-item.entity';
import { GrantRegulatoryOversightDto } from '../dto/regulatory-oversight.dto';
import { RegulatoryAuthority } from '../entities/regulatory-authority.entity';
import { RegulatoryCase, RegulatoryCaseReferral, RegulatoryCaseReferralStatus, RegulatoryCaseStatus } from '../entities/regulatory-case.entity';
import { RegulatoryOversightScope } from '../entities/regulatory-oversight.entity';

@Injectable()
export class RegulatoryOversightService {
  constructor(
    @InjectRepository(RegulatoryOversightScope) private readonly scopes: Repository<RegulatoryOversightScope>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(RegulatoryAuthority) private readonly authorities: Repository<RegulatoryAuthority>,
    @InjectRepository(RegulatoryCase) private readonly cases: Repository<RegulatoryCase>,
    @InjectRepository(RegulatoryCaseReferral) private readonly referrals: Repository<RegulatoryCaseReferral>,
  ) {}

  async grant(dto: GrantRegulatoryOversightDto) {
    const [organization, authority] = await Promise.all([
      this.organizations.findOne({ where: { id: dto.oversightOrganizationId } }),
      this.authorities.findOne({ where: { id: dto.authorityId, isActive: true } }),
    ]);
    if (!organization) throw new NotFoundEntityException('Organization', dto.oversightOrganizationId);
    if (organization.type !== OrganizationType.REGULATOR) throw new TraceabilityRuleException('An oversight body must be a regulator organization');
    if (!authority) throw new NotFoundEntityException('RegulatoryAuthority', dto.authorityId);
    const existing = await this.scopes.findOne({ where: { oversightOrganization: { id: organization.id }, authority: { id: authority.id } } });
    return existing ?? this.scopes.save(this.scopes.create({ oversightOrganization: organization, authority }));
  }

  list() { return this.scopes.find({ order: { createdAt: 'ASC' } }); }

  async revoke(id: number) {
    const scope = await this.scopes.findOne({ where: { id } });
    if (!scope) throw new NotFoundEntityException('RegulatoryOversightScope', id);
    await this.scopes.remove(scope);
  }

  async summary(organization: Organization) {
    const scopes = await this.scopes.find({ where: { oversightOrganization: { id: organization.id } } });
    if (scopes.length === 0) throw new TraceabilityRuleException('This organization has no configured oversight scope');
    const authorityIds = scopes.map((scope) => scope.authority.id);
    const closed = [RegulatoryCaseStatus.CLOSED, RegulatoryCaseStatus.RESOLVED];
    const authorities = await Promise.all(scopes.map(async (scope) => {
      const id = scope.authority.id;
      const [open, overdue, unassigned, resolved] = await Promise.all([
        this.cases.count({ where: { leadAuthority: { id }, status: Not(In(closed)) } }),
        this.cases.count({ where: { leadAuthority: { id }, status: Not(In(closed)), dueOn: LessThan(today()) as unknown as string } }),
        this.cases.count({ where: { leadAuthority: { id }, status: Not(In(closed)), assignedTo: IsNull() } }),
        this.cases.count({ where: { leadAuthority: { id }, status: RegulatoryCaseStatus.RESOLVED } }),
      ]);
      const pendingReferrals = await this.referrals.find({ where: { toAuthority: { id }, status: RegulatoryCaseReferralStatus.PENDING } });
      const target = scope.authority.referralResponseDays;
      const overdueReferrals = target === null ? 0 : pendingReferrals.filter((referral) => referral.referredAt.getTime() + target * 86_400_000 < Date.now()).length;
      return { authority: { id, code: scope.authority.code, name: scope.authority.name }, open, overdue, unassigned, resolved, overdueReferrals };
    }));
    const [pendingReferrals, acceptedReferrals, declinedReferrals] = await Promise.all([
      this.referrals.count({ where: { toAuthority: { id: In(authorityIds) }, status: RegulatoryCaseReferralStatus.PENDING } }),
      this.referrals.count({ where: { toAuthority: { id: In(authorityIds) }, status: RegulatoryCaseReferralStatus.ACCEPTED } }),
      this.referrals.count({ where: { toAuthority: { id: In(authorityIds) }, status: RegulatoryCaseReferralStatus.REJECTED } }),
    ]);
    return { authorities, referrals: { pending: pendingReferrals, accepted: acceptedReferrals, declined: declinedReferrals } };
  }
}
