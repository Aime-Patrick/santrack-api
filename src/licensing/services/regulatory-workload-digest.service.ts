import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EmailService } from '../../email/email.service';
import { today } from '../../item/entities/traceable-item.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import {
  RegulatoryCase,
  RegulatoryCaseStatus,
} from '../entities/regulatory-case.entity';
import {
  RegulatoryOversightMode,
  RegulatoryOversightScope,
} from '../entities/regulatory-oversight.entity';
import { RegulatoryTeamService } from './regulatory-team.service';

const DONE = [RegulatoryCaseStatus.CLOSED, RegulatoryCaseStatus.RESOLVED];

/**
 * Morning digests for team leaders; Monday digests for SUPERVISE overseers.
 */
@Injectable()
export class RegulatoryWorkloadDigestService {
  private readonly logger = new Logger(RegulatoryWorkloadDigestService.name);
  private readonly appPublicUrl: string;

  constructor(
    @InjectRepository(RegulatoryCase)
    private readonly cases: Repository<RegulatoryCase>,
    @InjectRepository(RegulatoryOversightScope)
    private readonly scopes: Repository<RegulatoryOversightScope>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly teams: RegulatoryTeamService,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.appPublicUrl = (
      config.get<string>('appPublicUrl') ??
      (config.get<string[]>('corsOrigins') ?? ['http://localhost:3000'])[0] ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  @Cron(CronExpression.EVERY_DAY_AT_7AM, {
    name: 'regulatory-leader-digest',
    timeZone: 'Africa/Kigali',
  })
  async dailyLeaderDigest(): Promise<{ sent: number }> {
    const result = await this.sendLeaderDigests();
    this.logger.log(`Leader digests sent: ${result.sent}`);
    return result;
  }

  /** Monday 07:15 Africa/Kigali — overseer weekly rollup. */
  @Cron('15 7 * * 1', {
    name: 'regulatory-overseer-digest',
    timeZone: 'Africa/Kigali',
  })
  async weeklyOverseerDigest(): Promise<{ sent: number }> {
    const result = await this.sendOverseerDigests();
    this.logger.log(`Overseer digests sent: ${result.sent}`);
    return result;
  }

  async sendLeaderDigests(): Promise<{ sent: number }> {
    const led = await this.teams.listLedTeams();
    let sent = 0;

    for (const { team, leaders } of led) {
      const { open, overdue } = await this.teamOpenStats(team.id);
      if (open === 0 && overdue === 0) continue;

      const lines = [
        `${team.name}: ${open} open, ${overdue} overdue`,
        team.maxOpenCases != null
          ? `Workload cap: ${open} / ${team.maxOpenCases}`
          : null,
      ].filter(Boolean) as string[];

      for (const leader of leaders) {
        if (!leader.email) continue;
        await this.email.sendWorkloadDigest({
          to: leader.email,
          recipientName: leader.fullName,
          title: `Daily desk digest — ${team.name}`,
          periodLabel: 'Daily',
          summaryLines: lines,
          dashboardUrl: `${this.appPublicUrl}/dashboard/regulator?tab=enforcement`,
        });
        sent += 1;
      }
    }
    return { sent };
  }

  async sendOverseerDigests(): Promise<{ sent: number }> {
    const scopes = await this.scopes.find({
      where: { mode: RegulatoryOversightMode.SUPERVISE },
      relations: {
        oversightOrganization: true,
        authority: true,
      },
    });

    const byOrg = new Map<
      number,
      { organization: Organization; authorities: typeof scopes }
    >();
    for (const scope of scopes) {
      const org = scope.oversightOrganization;
      if (!org?.id) continue;
      const bucket = byOrg.get(org.id);
      if (bucket) bucket.authorities.push(scope);
      else byOrg.set(org.id, { organization: org, authorities: [scope] });
    }

    let sent = 0;
    for (const { organization, authorities } of byOrg.values()) {
      const lines: string[] = [];
      for (const scope of authorities) {
        const { open, overdue } = await this.authorityOpenStats(scope.authority.id);
        lines.push(
          `${scope.authority.name}: ${open} open cases, ${overdue} overdue`,
        );
      }
      if (lines.length === 0) continue;

      const recipients = await this.users.find({
        where: {
          organization: { id: organization.id },
          role: In([UserRole.ORG_ADMIN, UserRole.MANAGEMENT]),
        },
      });

      for (const user of recipients) {
        if (!user.email) continue;
        await this.email.sendWorkloadDigest({
          to: user.email,
          recipientName: user.fullName,
          title: `Weekly oversight digest — ${organization.name}`,
          periodLabel: 'Weekly',
          summaryLines: lines,
          dashboardUrl: `${this.appPublicUrl}/dashboard`,
        });
        sent += 1;
      }
    }
    return { sent };
  }

  private async teamOpenStats(
    teamId: number,
  ): Promise<{ open: number; overdue: number }> {
    const day = today();
    const open = await this.cases
      .createQueryBuilder('c')
      .where('c.assigned_team_id = :teamId', { teamId })
      .andWhere('c.status NOT IN (:...done)', { done: DONE })
      .getCount();
    const overdue = await this.cases
      .createQueryBuilder('c')
      .where('c.assigned_team_id = :teamId', { teamId })
      .andWhere('c.status NOT IN (:...done)', { done: DONE })
      .andWhere('c.due_on IS NOT NULL')
      .andWhere('c.due_on < :day', { day })
      .getCount();
    return { open, overdue };
  }

  private async authorityOpenStats(
    authorityId: number,
  ): Promise<{ open: number; overdue: number }> {
    const day = today();
    const open = await this.cases
      .createQueryBuilder('c')
      .where('c.lead_authority_id = :authorityId', { authorityId })
      .andWhere('c.status NOT IN (:...done)', { done: DONE })
      .getCount();
    const overdue = await this.cases
      .createQueryBuilder('c')
      .where('c.lead_authority_id = :authorityId', { authorityId })
      .andWhere('c.status NOT IN (:...done)', { done: DONE })
      .andWhere('c.due_on IS NOT NULL')
      .andWhere('c.due_on < :day', { day })
      .getCount();
    return { open, overdue };
  }
}
