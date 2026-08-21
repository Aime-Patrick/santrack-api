import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { compare, hash } from 'bcryptjs';

import {
  DuplicateException,
  InvalidCredentialsException,
} from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { LoginDto, RegisterDto } from '../dto/auth.dto';
import {
  CAPABILITIES_CONFERRED_BY_ORGANIZATION_TYPE,
  CAPABILITY_DESCRIPTIONS,
  Capability,
  capabilitiesFor,
} from '../capabilities';
import { User } from '../entities/user.entity';
import { UserRole } from '../user-role.enum';

export interface AuthResult {
  token: string;
  user: {
    id: number;
    email: string;
    fullName: string;
    role: UserRole;
    organization: { id: number; name: string; type: string } | null;
    /**
     * Everything this person may do, already resolved from their role and
     * their organization's standing.
     *
     * The browser used to keep its own copy of the capability table, which
     * drifted: a production manager was shown the industry registry because
     * the copy was a year out of date. Sending the answer rather than the
     * inputs means the navigation cannot disagree with the guard.
     */
    capabilities: Capability[];
  };
}

/** The role/capability reference table, as the Roles screen consumes it. */
export interface CapabilityCatalogue {
  capabilities: {
    capability: Capability;
    description: string;
    /** True when standing, not job title, is what grants it. */
    conferredByStanding: boolean;
  }[];
  roles: { role: UserRole; capabilities: Capability[] }[];
  standing: { organizationType: string; capabilities: Capability[] }[];
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Creates an account. The first user of an organization becomes its admin
   * during onboarding; until they complete organization setup they hold no
   * position in any chain of custody.
   */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    if (await this.users.findOne({ where: { email } })) {
      throw new DuplicateException(`${email} is already registered`);
    }

    const user = await this.users.save(
      this.users.create({
        email,
        passwordHash: await hash(dto.password, 10),
        fullName: dto.fullName.trim(),
        role: UserRole.ORG_ADMIN,
        organization: null,
      }),
    );

    return this.issue(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    // The hash is not selected by default, so it is asked for explicitly here
    // and nowhere else.
    const user = await this.users.findOne({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        passwordHash: true,
      },
      relations: { organization: true },
    });

    // The same error whether the account is unknown or the password is wrong,
    // so the response cannot be used to discover which emails are registered.
    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new InvalidCredentialsException();
    }

    return this.issue(user);
  }

  async me(user: User): Promise<AuthResult['user']> {
    return this.describe(user);
  }

  /**
   * The reference table behind the Roles screen: every capability the platform
   * defines, what each one means, and which roles hold it.
   *
   * Served rather than duplicated in the browser for the same reason `me`
   * carries a resolved list - there is one table, and it lives in
   * capabilities.ts.
   */
  catalogue(): CapabilityCatalogue {
    return {
      capabilities: Object.values(Capability).map((capability) => ({
        capability,
        description: CAPABILITY_DESCRIPTIONS[capability],
        conferredByStanding: Object.values(
          CAPABILITIES_CONFERRED_BY_ORGANIZATION_TYPE,
        ).some((list) => list?.includes(capability)),
      })),
      roles: Object.values(UserRole).map((role) => ({
        role,
        capabilities: capabilitiesFor(role),
      })),
      standing: Object.entries(CAPABILITIES_CONFERRED_BY_ORGANIZATION_TYPE).map(
        ([organizationType, capabilities]) => ({
          organizationType,
          capabilities: capabilities ?? [],
        }),
      ),
    };
  }

  private async issue(user: User): Promise<AuthResult> {
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, user: this.describe(user) };
  }

  private describe(user: User): AuthResult['user'] {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organization: user.organization
        ? {
            id: user.organization.id,
            name: user.organization.name,
            type: user.organization.type,
          }
        : null,
      capabilities: capabilitiesFor(user.role, user.organization?.type),
    };
  }
}

export function describeOrganization(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    type: organization.type,
  };
}
