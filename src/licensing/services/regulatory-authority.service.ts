import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { UserManagementService } from '../../auth/services/user-management.service';
import { OrganizationService } from '../../organization/services/organization.service';
import { ConfigureOwnAuthorityDto, CreateRegulatoryAuthorityDto, OnboardRegulatoryAuthorityDto, UpdateRegulatoryAuthorityDto } from '../dto/regulatory-authority.dto';
import { RegulatoryAuthority } from '../entities/regulatory-authority.entity';

@Injectable()
export class RegulatoryAuthorityService {
  constructor(
    @InjectRepository(RegulatoryAuthority) private readonly authorities: Repository<RegulatoryAuthority>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly organizationService: OrganizationService,
    private readonly userManagement: UserManagementService,
  ) {}

  list() { return this.authorities.find({ order: { name: 'ASC' } }); }

  async forOperator(organization: Organization): Promise<RegulatoryAuthority> {
    const authority = await this.authorities.findOne({ where: { operatingOrganization: { id: organization.id }, isActive: true } });
    if (!authority) throw new TraceabilityRuleException('This regulator is not configured as an active SanTrack authority');
    return authority;
  }

  async forOrganization(organization: Organization): Promise<RegulatoryAuthority> {
    const authority = await this.authorities.findOne({ where: { operatingOrganization: { id: organization.id } } });
    if (!authority) throw new NotFoundEntityException('RegulatoryAuthority', organization.id);
    return authority;
  }

  async create(dto: CreateRegulatoryAuthorityDto): Promise<RegulatoryAuthority> {
    const organization = await this.organizations.findOne({ where: { id: dto.operatingOrganizationId } });
    if (!organization) throw new NotFoundEntityException('Organization', dto.operatingOrganizationId);
    if (organization.type !== OrganizationType.REGULATOR) throw new TraceabilityRuleException('An authority must operate through a regulator organization');
    const code = dto.code.trim().toUpperCase();
    const existing = await this.authorities.findOne({ where: { code } });
    if (existing) throw new TraceabilityRuleException(`Authority ${code} already exists`);
    return this.authorities.save(this.authorities.create({
      code, name: organization.name, operatingOrganization: organization,
      mandates: [], caseCategories: [], teams: [],
      referralResponseDays: null,
    }));
  }

  async onboard(actor: User, dto: OnboardRegulatoryAuthorityDto): Promise<{ authority: RegulatoryAuthority; organization: Organization; adminUser: { id: number; email: string; fullName?: string; role: string; alreadyExisted?: boolean } }> {
    let organization: Organization;
    if (dto.operatingOrganizationId) {
      const existing = await this.organizations.findOne({ where: { id: dto.operatingOrganizationId } });
      if (!existing) throw new NotFoundEntityException('Organization', dto.operatingOrganizationId);
      if (existing.type !== OrganizationType.REGULATOR) throw new TraceabilityRuleException('An authority must operate through a regulator organization');
      organization = existing;
    } else {
      organization = await this.organizationService.registerRegulator(dto.name.trim());
    }

    const code = dto.code.trim().toUpperCase();
    let authority = await this.authorities.findOne({ where: { operatingOrganization: { id: organization.id } } });
    if (!authority) {
      const codeExists = await this.authorities.findOne({ where: { code } });
      if (codeExists) throw new TraceabilityRuleException(`Authority code ${code} is already in use`);
      authority = await this.authorities.save(this.authorities.create({
        code,
        name: organization.name,
        operatingOrganization: organization,
        mandates: [],
        caseCategories: [],
        teams: [],
        referralResponseDays: null,
      }));
    } else if (authority.code !== code) {
      const codeExists = await this.authorities.findOne({ where: { code } });
      if (codeExists && codeExists.id !== authority.id) throw new TraceabilityRuleException(`Authority code ${code} is already in use`);
      authority.code = code;
      authority = await this.authorities.save(authority);
    }

    let adminUserRecord: { id: number; email: string; fullName?: string | null; role: string };
    let alreadyExisted = false;

    if (dto.adminEmail?.trim()) {
      const email = dto.adminEmail.trim().toLowerCase();
      const existingUser = await this.users.findOne({ where: { email }, relations: ['organization'] });
      if (existingUser) {
        if (existingUser.organization?.id === organization.id) {
          if (existingUser.role !== UserRole.ORG_ADMIN) {
            existingUser.role = UserRole.ORG_ADMIN;
            await this.users.save(existingUser);
          }
          adminUserRecord = existingUser;
          alreadyExisted = true;
        } else {
          throw new TraceabilityRuleException(`User with email ${email} already belongs to another organization (${existingUser.organization?.name ?? 'Unknown'})`);
        }
      } else {
        if (!dto.adminPassword || dto.adminPassword.length < 8) {
          throw new TraceabilityRuleException('Password must be at least 8 characters for a new administrator account');
        }
        adminUserRecord = await this.userManagement.create(actor, {
          email,
          fullName: dto.adminFullName?.trim() || `${organization.name} Admin`,
          password: dto.adminPassword,
          organizationId: organization.id,
          role: UserRole.ORG_ADMIN,
          generatePassword: false,
        });
      }
    } else {
      const existingAdmin = await this.users.findOne({ where: { organization: { id: organization.id }, role: UserRole.ORG_ADMIN } });
      if (existingAdmin) {
        adminUserRecord = existingAdmin;
        alreadyExisted = true;
      } else {
        const anyUser = await this.users.findOne({ where: { organization: { id: organization.id } } });
        if (anyUser) {
          anyUser.role = UserRole.ORG_ADMIN;
          await this.users.save(anyUser);
          adminUserRecord = anyUser;
          alreadyExisted = true;
        } else {
          throw new TraceabilityRuleException('No administrator account exists for this organization. Please provide an admin email and password.');
        }
      }
    }

    return {
      authority,
      organization,
      adminUser: { id: adminUserRecord.id, email: adminUserRecord.email, fullName: adminUserRecord.fullName ?? undefined, role: adminUserRecord.role, alreadyExisted },
    };
  }

  async update(id: number, dto: UpdateRegulatoryAuthorityDto): Promise<RegulatoryAuthority> {
    const authority = await this.authorities.findOne({ where: { id } });
    if (!authority) throw new NotFoundEntityException('RegulatoryAuthority', id);
    if (dto.isActive !== undefined) authority.isActive = dto.isActive;
    return this.authorities.save(authority);
  }

  async configureOwn(organization: Organization, dto: ConfigureOwnAuthorityDto): Promise<RegulatoryAuthority> {
    const authority = await this.forOrganization(organization);
    if (dto.mandates) authority.mandates = normalize(dto.mandates);
    if (dto.caseCategories) authority.caseCategories = normalize(dto.caseCategories);
    if (dto.teams) authority.teams = normalize(dto.teams);
    if (dto.referralResponseDays !== undefined) authority.referralResponseDays = dto.referralResponseDays;
    return this.authorities.save(authority);
  }
}

function normalize(mandates: string[]): string[] {
  return [...new Set(mandates.map((mandate) => mandate.trim()).filter(Boolean))];
}
