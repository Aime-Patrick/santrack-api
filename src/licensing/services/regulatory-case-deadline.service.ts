import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Not, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { today } from '../../item/entities/traceable-item.entity';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { NotificationsGateway } from '../../notifications/gateways/notifications.gateway';
import {
  RegulatoryCase,
  RegulatoryCaseEvent,
  RegulatoryCaseEventType,
  RegulatoryCasePriority,
  RegulatoryCaseStatus,
} from '../entities/regulatory-case.entity';

export interface RegulatoryCaseDeadlineResult {
  overdue: number;
  escalated: number;
  notified: number;
}

/**
 * Makes a date on a case operational. A single deadline event is written for
 * each overdue case, so the overnight job is safe to run again after a crash
 * and officers are not spammed every morning.
 */
@Injectable()
export class RegulatoryCaseDeadlineService {
  private readonly logger = new Logger(RegulatoryCaseDeadlineService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RegulatoryCase)
    private readonly cases: Repository<RegulatoryCase>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly notifications: NotificationsGateway,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, {
    name: 'regulatory-case-deadlines',
    timeZone: 'Africa/Kigali',
  })
  async daily(): Promise<RegulatoryCaseDeadlineResult> {
    const result = await this.sweep();
    this.logger.log(`Regulatory deadlines: ${result.overdue} overdue, ${result.escalated} escalated, ${result.notified} notified`);
    return result;
  }

  async sweep(): Promise<RegulatoryCaseDeadlineResult> {
    const candidates = await this.cases.find({
      where: {
        dueOn: LessThan(today()) as unknown as string,
        status: Not(In([RegulatoryCaseStatus.CLOSED, RegulatoryCaseStatus.RESOLVED])),
      },
      take: 500,
      order: { dueOn: 'ASC' },
    });

    let overdue = 0;
    let escalated = 0;
    let notified = 0;
    for (const candidate of candidates) {
      const result = await this.markOnce(candidate.id);
      if (!result) continue;
      overdue += 1;
      if (result.escalated) escalated += 1;
      notified += await this.notify(result.caseRecord, result.escalated);
    }
    return { overdue, escalated, notified };
  }

  private async markOnce(caseId: number): Promise<{ caseRecord: RegulatoryCase; escalated: boolean } | null> {
    return this.dataSource.transaction(async (manager) => {
      const caseRecord = await manager.findOne(RegulatoryCase, { where: { id: caseId } });
      if (!caseRecord || !caseRecord.dueOn || caseRecord.dueOn >= today() || [RegulatoryCaseStatus.CLOSED, RegulatoryCaseStatus.RESOLVED].includes(caseRecord.status)) {
        return null;
      }
      const alreadyRecorded = await manager.exists(RegulatoryCaseEvent, {
        where: {
          case: { id: caseId },
          type: In([RegulatoryCaseEventType.DEADLINE_OVERDUE, RegulatoryCaseEventType.DEADLINE_ESCALATED]),
        },
      });
      if (alreadyRecorded) return null;

      const escalated = [RegulatoryCasePriority.HIGH, RegulatoryCasePriority.CRITICAL].includes(caseRecord.priority);
      const type = escalated ? RegulatoryCaseEventType.DEADLINE_ESCALATED : RegulatoryCaseEventType.DEADLINE_OVERDUE;
      if (escalated) {
        caseRecord.status = RegulatoryCaseStatus.ESCALATED;
        await manager.save(RegulatoryCase, caseRecord);
      }
      await manager.save(manager.create(RegulatoryCaseEvent, {
        case: caseRecord,
        actor: null,
        type,
        summary: escalated ? `Deadline missed — ${caseRecord.priority.toLowerCase()} priority case escalated` : 'Deadline missed — supervisor notified',
        detail: { dueOn: caseRecord.dueOn, priority: caseRecord.priority, automatic: true },
      }));
      return { caseRecord, escalated };
    });
  }

  private async notify(caseRecord: RegulatoryCase, escalated: boolean): Promise<number> {
    const authorityId = caseRecord.assignedTo?.organization?.id;
    // A recall can be opened by the affected business. Until it is assigned to
    // a regulator, platform administrators are the only safe supervisory
    // fallback; the affected business must never receive a regulator alert.
    const supervisors = authorityId
      ? await this.users.find({
          where: [
            { organization: { id: authorityId }, role: UserRole.ORG_ADMIN },
            { organization: { id: authorityId }, role: UserRole.MANAGEMENT },
          ],
        })
      : await this.users.find({ where: { role: UserRole.SYSTEM_ADMIN } });
    const recipients = new Map<number, User>();
    if (caseRecord.assignedTo) recipients.set(caseRecord.assignedTo.id, caseRecord.assignedTo);
    for (const supervisor of supervisors) recipients.set(supervisor.id, supervisor);

    let notified = 0;
    for (const recipient of recipients.values()) {
      await this.notifications.sendToUser(recipient.id, {
        type: escalated ? NotificationType.ERROR : NotificationType.WARNING,
        title: escalated ? `Escalated case ${caseRecord.caseNumber}` : `Overdue case ${caseRecord.caseNumber}`,
        message: `${caseRecord.title} was due on ${caseRecord.dueOn}. ${escalated ? 'It has been escalated for immediate regulator action.' : 'Assign follow-up or update the deadline decision.'}`,
        module: 'regulator',
        actionUrl: '/dashboard/regulator',
      });
      notified += 1;
    }
    return notified;
  }
}
