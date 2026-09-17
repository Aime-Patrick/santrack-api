import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import {
  AddRegulatoryTeamMemberDto,
  CreateRegulatoryTeamDto,
  UpdateRegulatoryTeamDto,
  UpdateRegulatoryTeamMemberDto,
} from '../dto/regulatory-team.dto';
import { RegulatoryAuthority } from '../entities/regulatory-authority.entity';
import { RegulatoryCase } from '../entities/regulatory-case.entity';
import {
  RegulatoryTeam,
  RegulatoryTeamMember,
} from '../entities/regulatory-team.entity';
import { RegulatoryAuthorityService } from './regulatory-authority.service';

@Injectable()
export class RegulatoryTeamService {
  constructor(
    @InjectRepository(RegulatoryTeam)
    private readonly teams: Repository<RegulatoryTeam>,
    @InjectRepository(RegulatoryTeamMember)
    private readonly members: Repository<RegulatoryTeamMember>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(RegulatoryCase)
    private readonly cases: Repository<RegulatoryCase>,
    private readonly authorities: RegulatoryAuthorityService,
  ) {}

  async listForOrganization(
    organization: Organization,
    includeInactive = false,
  ): Promise<RegulatoryTeam[]> {
    const authority = await this.authorities.forOrganization(organization);
    return this.teams.find({
      where: includeInactive
        ? { authority: { id: authority.id } }
        : { authority: { id: authority.id }, active: true },
      relations: { members: { user: true } },
      order: { name: 'ASC' },
    });
  }

  /** Active team names — drop-in replacement for `authority.teams` string[]. */
  async activeNames(authorityId: number): Promise<string[]> {
    const rows = await this.teams.find({
      where: { authority: { id: authorityId }, active: true },
      order: { name: 'ASC' },
    });
    return rows.map((row) => row.name);
  }

  async findActiveByName(
    authorityId: number,
    name: string,
  ): Promise<RegulatoryTeam | null> {
    return this.teams.findOne({
      where: {
        authority: { id: authorityId },
        name: name.trim(),
        active: true,
      },
      relations: { members: { user: true } },
    });
  }

  async findActiveById(
    authorityId: number,
    teamId: number,
  ): Promise<RegulatoryTeam | null> {
    return this.teams.findOne({
      where: {
        id: teamId,
        authority: { id: authorityId },
        active: true,
      },
      relations: { members: { user: true } },
    });
  }

  async create(
    organization: Organization,
    dto: CreateRegulatoryTeamDto,
  ): Promise<RegulatoryTeam> {
    const authority = await this.authorities.forOrganization(organization);
    const name = dto.name.trim();
    if (!name) throw new TraceabilityRuleException('Team name is required');
    const existing = await this.teams.findOne({
      where: { authority: { id: authority.id }, name },
    });
    if (existing) {
      if (!existing.active) {
        existing.active = true;
        return this.teams.save(existing);
      }
      throw new TraceabilityRuleException(`Team "${name}" already exists`);
    }
    const saved = await this.teams.save(
      this.teams.create({
        authority,
        name,
        active: true,
        maxOpenCases:
          dto.maxOpenCases === undefined ? null : dto.maxOpenCases,
      }),
    );
    return this.one(authority.id, saved.id);
  }

  async update(
    organization: Organization,
    teamId: number,
    dto: UpdateRegulatoryTeamDto,
  ): Promise<RegulatoryTeam> {
    const authority = await this.authorities.forOrganization(organization);
    const team = await this.one(authority.id, teamId);
    const previousName = team.name;
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new TraceabilityRuleException('Team name is required');
      const clash = await this.teams.findOne({
        where: { authority: { id: authority.id }, name },
      });
      if (clash && clash.id !== team.id) {
        throw new TraceabilityRuleException(`Team "${name}" already exists`);
      }
      team.name = name;
    }
    if (dto.active !== undefined) team.active = dto.active;
    if (dto.maxOpenCases !== undefined) team.maxOpenCases = dto.maxOpenCases;
    await this.teams.save(team);
    if (dto.name !== undefined && team.name !== previousName) {
      await this.cases
        .createQueryBuilder()
        .update(RegulatoryCase)
        .set({ assignedTeam: team.name })
        .where('assigned_team_id = :teamId', { teamId: team.id })
        .execute();
    }
    return this.one(authority.id, teamId);
  }

  async addMember(
    organization: Organization,
    teamId: number,
    dto: AddRegulatoryTeamMemberDto,
  ): Promise<RegulatoryTeam> {
    const authority = await this.authorities.forOrganization(organization);
    const team = await this.one(authority.id, teamId);
    const user = await this.users.findOne({
      where: { id: dto.userId },
      relations: { organization: true },
    });
    if (!user) throw new NotFoundEntityException('User', dto.userId);
    if (user.organization?.id !== organization.id) {
      throw new TraceabilityRuleException(
        'Only users in your authority organization may join a team',
      );
    }
    const existing = await this.members.findOne({
      where: { team: { id: team.id }, user: { id: user.id } },
    });
    if (existing) {
      if (dto.isLeader) {
        await this.setLeader(team.id, user.id, true);
      }
      return this.one(authority.id, teamId);
    }
    await this.members.save(
      this.members.create({
        team,
        user,
        isLeader: Boolean(dto.isLeader),
      }),
    );
    if (dto.isLeader) await this.setLeader(team.id, user.id, true);
    return this.one(authority.id, teamId);
  }

  async updateMember(
    organization: Organization,
    teamId: number,
    userId: number,
    dto: UpdateRegulatoryTeamMemberDto,
  ): Promise<RegulatoryTeam> {
    const authority = await this.authorities.forOrganization(organization);
    await this.one(authority.id, teamId);
    await this.setLeader(teamId, userId, dto.isLeader);
    return this.one(authority.id, teamId);
  }

  async removeMember(
    organization: Organization,
    teamId: number,
    userId: number,
  ): Promise<RegulatoryTeam> {
    const authority = await this.authorities.forOrganization(organization);
    await this.one(authority.id, teamId);
    const member = await this.members.findOne({
      where: { team: { id: teamId }, user: { id: userId } },
    });
    if (!member) throw new NotFoundEntityException('RegulatoryTeamMember', userId);
    await this.members.remove(member);
    return this.one(authority.id, teamId);
  }

  /** Active team names this user belongs to under the authority. */
  async teamNamesForUser(authorityId: number, userId: number): Promise<string[]> {
    const rows = await this.members.find({
      where: {
        user: { id: userId },
        team: { authority: { id: authorityId }, active: true },
      },
      relations: { team: true },
    });
    return rows.map((row) => row.team.name);
  }

  /** Active team ids this user belongs to under the authority. */
  async teamIdsForUser(authorityId: number, userId: number): Promise<number[]> {
    const rows = await this.members.find({
      where: {
        user: { id: userId },
        team: { authority: { id: authorityId }, active: true },
      },
      relations: { team: true },
    });
    return rows.map((row) => row.team.id);
  }

  /** Whether the user is the leader of any of the named teams. */
  async isLeaderOfAny(
    authorityId: number,
    userId: number,
    teamNames: string[],
  ): Promise<boolean> {
    const cleaned = teamNames.map((name) => name.trim()).filter(Boolean);
    if (cleaned.length === 0) return false;
    const count = await this.members
      .createQueryBuilder('m')
      .innerJoin('m.team', 'team')
      .where('team.authority_id = :authorityId', { authorityId })
      .andWhere('team.active = true')
      .andWhere('m.user_id = :userId', { userId })
      .andWhere('m.is_leader = true')
      .andWhere('team.name IN (:...names)', { names: cleaned })
      .getCount();
    return count > 0;
  }

  /** Whether the user is the leader of any of the given team ids. */
  async isLeaderOfAnyIds(
    authorityId: number,
    userId: number,
    teamIds: number[],
  ): Promise<boolean> {
    const ids = [...new Set(teamIds.filter((id) => Number.isFinite(id) && id > 0))];
    if (ids.length === 0) return false;
    const count = await this.members
      .createQueryBuilder('m')
      .innerJoin('m.team', 'team')
      .where('team.authority_id = :authorityId', { authorityId })
      .andWhere('team.active = true')
      .andWhere('m.user_id = :userId', { userId })
      .andWhere('m.is_leader = true')
      .andWhere('team.id IN (:...ids)', { ids })
      .getCount();
    return count > 0;
  }

  /** Leaders of a named team (for overdue / escalation alerts). */
  async leadersForTeamName(
    authorityId: number,
    teamName: string,
  ): Promise<User[]> {
    const cleaned = teamName.trim();
    if (!cleaned) return [];
    const rows = await this.members.find({
      where: {
        isLeader: true,
        team: {
          authority: { id: authorityId },
          name: cleaned,
          active: true,
        },
      },
      relations: { user: true },
    });
    return rows.map((row) => row.user).filter(Boolean);
  }

  async leadersForTeamId(authorityId: number, teamId: number): Promise<User[]> {
    if (!teamId) return [];
    const rows = await this.members.find({
      where: {
        isLeader: true,
        team: {
          id: teamId,
          authority: { id: authorityId },
          active: true,
        },
      },
      relations: { user: true },
    });
    return rows.map((row) => row.user).filter(Boolean);
  }

  /**
   * When configureOwn still receives a teams string[], replace the active set:
   * create missing names, reactivate known ones, soft-deactivate the rest.
   */
  async replaceNamesFromLegacy(
    authority: RegulatoryAuthority,
    names: string[],
  ): Promise<void> {
    const cleaned = [
      ...new Set(names.map((name) => name.trim()).filter(Boolean)),
    ];
    const existing = await this.teams.find({
      where: { authority: { id: authority.id } },
    });
    const byName = new Map(existing.map((team) => [team.name, team]));
    for (const name of cleaned) {
      const row = byName.get(name);
      if (row) {
        if (!row.active) {
          row.active = true;
          await this.teams.save(row);
        }
      } else {
        await this.teams.save(
          this.teams.create({
            authority,
            name,
            active: true,
            maxOpenCases: null,
          }),
        );
      }
    }
    for (const row of existing) {
      if (!cleaned.includes(row.name) && row.active) {
        row.active = false;
        await this.teams.save(row);
      }
    }
  }

  /** Open (non-closed/resolved) cases currently on this desk. */
  async openCaseCount(teamId: number): Promise<number> {
    return this.cases
      .createQueryBuilder('c')
      .where('c.assigned_team_id = :teamId', { teamId })
      .andWhere('c.status NOT IN (:...done)', {
        done: ['CLOSED', 'RESOLVED'],
      })
      .getCount();
  }

  /**
   * Rejects assignment when the desk already holds `maxOpenCases` open work.
   * No-op when the cap is unset.
   */
  async assertWithinWorkloadCap(team: RegulatoryTeam): Promise<void> {
    if (team.maxOpenCases == null) return;
    const open = await this.openCaseCount(team.id);
    if (open >= team.maxOpenCases) {
      throw new TraceabilityRuleException(
        `${team.name} is at its workload cap (${team.maxOpenCases} open cases). Reassign or close work before adding more.`,
      );
    }
  }

  /** Every active team that currently has a leader (for digests). */
  async listLedTeams(): Promise<
    Array<{ team: RegulatoryTeam; leaders: User[] }>
  > {
    const rows = await this.members.find({
      where: {
        isLeader: true,
        team: { active: true },
      },
      relations: { team: { authority: true }, user: true },
    });
    const byTeam = new Map<number, { team: RegulatoryTeam; leaders: User[] }>();
    for (const row of rows) {
      if (!row.team?.id || !row.user) continue;
      const existing = byTeam.get(row.team.id);
      if (existing) {
        existing.leaders.push(row.user);
      } else {
        byTeam.set(row.team.id, { team: row.team, leaders: [row.user] });
      }
    }
    return [...byTeam.values()];
  }

  private async setLeader(
    teamId: number,
    userId: number,
    isLeader: boolean,
  ): Promise<void> {
    const member = await this.members.findOne({
      where: { team: { id: teamId }, user: { id: userId } },
    });
    if (!member) throw new NotFoundEntityException('RegulatoryTeamMember', userId);
    if (isLeader) {
      await this.members
        .createQueryBuilder()
        .update(RegulatoryTeamMember)
        .set({ isLeader: false })
        .where('team_id = :teamId', { teamId })
        .execute();
    }
    member.isLeader = isLeader;
    await this.members.save(member);
  }

  private async one(authorityId: number, teamId: number): Promise<RegulatoryTeam> {
    const team = await this.teams.findOne({
      where: { id: teamId, authority: { id: authorityId } },
      relations: { members: { user: true } },
    });
    if (!team) throw new NotFoundEntityException('RegulatoryTeam', teamId);
    team.members = (team.members ?? []).sort(
      (a, b) => Number(b.isLeader) - Number(a.isLeader) || a.id - b.id,
    );
    return team;
  }
}
