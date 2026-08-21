import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Not, Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { TraceableItem, today } from '../../item/entities/traceable-item.entity';
import { ItemStatus } from '../../item/item.enums';
import { LicenseService } from '../../licensing/services/license.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';

export interface ExpirySweepResult {
  expired: number;
  nearExpiryNotified: number;
  licencesLapsed: number;
}

/**
 * Nightly maintenance of things that go stale on a date rather than on an
 * action (Core Architecture §0.1 capability 6: products with expiration dates
 * "must be monitored and prevented/flagged when sold after expiry").
 *
 * Prevention was already in place - a sale checks the date and refuses. What
 * was missing is the monitoring. Without a sweep an item past its date keeps
 * ACTIVE status and keeps counting toward availableUnits, so the shelf reads
 * as sellable stock right up until someone tries to sell it. The dashboard was
 * telling the truth about the database and a lie about the warehouse.
 *
 * Everything here is idempotent and safe to run twice: the queries select only
 * rows that still need changing.
 */
@Injectable()
export class ExpiryService {
  private readonly logger = new Logger(ExpiryService.name);
  private readonly nearExpiryDays: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly recorder: EventRecorder,
    private readonly notifications: NotificationsService,
    private readonly licenses: LicenseService,
    config: ConfigService,
  ) {
    this.nearExpiryDays = config.get<number>('maintenance.nearExpiryDays') ?? 30;
  }

  /**
   * Runs in the small hours, when a batch of status changes is least likely to
   * collide with someone scanning the same items on the floor.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'expiry-sweep' })
  async nightly(): Promise<ExpirySweepResult> {
    const result = await this.sweep();
    this.logger.log(
      `Expiry sweep: ${result.expired} item(s) expired, ` +
        `${result.nearExpiryNotified} near-expiry notice(s), ` +
        `${result.licencesLapsed} licence(s) lapsed`,
    );
    return result;
  }

  /** The sweep itself, exposed so it can be triggered and tested directly. */
  async sweep(): Promise<ExpirySweepResult> {
    const expired = await this.expirePastDate();
    const nearExpiryNotified = await this.warnOnNearExpiry();
    const licencesLapsed = await this.lapseLicences();
    return { expired, nearExpiryNotified, licencesLapsed };
  }

  /**
   * Moves stock whose date has passed out of ACTIVE.
   *
   * Only ACTIVE is touched. Something already QUARANTINED, RECALLED or
   * DESTROYED has a more specific explanation attached to it, and overwriting
   * that with "expired" would lose the reason a human recorded - a recalled
   * item that also happens to be out of date is still recalled, and that is
   * what a consumer scanning it needs to be told.
   */
  private async expirePastDate(): Promise<number> {
    const now = today();
    const due = await this.items.find({
      where: {
        status: ItemStatus.ACTIVE,
        expiresOn: LessThan(now) as unknown as string,
      },
      take: 5000,
    });

    let changed = 0;
    for (const item of due) {
      await this.dataSource.transaction(async (manager) => {
        // Re-read inside the transaction: a sweep of thousands takes long
        // enough that someone may have sold or quarantined this item since the
        // list was built.
        const fresh = await manager.findOne(TraceableItem, {
          where: { id: item.id },
        });
        if (!fresh || fresh.status !== ItemStatus.ACTIVE || !fresh.isExpired(now)) {
          return;
        }

        fresh.status = ItemStatus.EXPIRED;
        await manager.save(TraceableItem, fresh);

        await this.recorder.record(manager, {
          item: fresh,
          type: EventType.EXPIRED,
          actor: null,
          sourceOrganization: fresh.holder,
          sourceLocation: fresh.location,
          quantity: fresh.quantity,
          notes: `Automatically expired: shelf date ${fresh.expiresOn} has passed`,
        });

        changed += 1;
      });
    }

    return changed;
  }

  /**
   * Tells holders what is about to go out of date while they can still act -
   * the "near expiry alerts" of the proposal's batch-lifecycle workflow.
   *
   * Grouped per organization into one notice rather than one per item: a
   * warehouse with four hundred expiring yoghurts needs a number and a prompt,
   * not four hundred unread notifications.
   */
  private async warnOnNearExpiry(): Promise<number> {
    const now = today();
    const horizon = addDays(now, this.nearExpiryDays);

    const rows = await this.items
      .createQueryBuilder('i')
      .select('i.holder_id', 'organizationId')
      .addSelect('COUNT(i.id)', 'count')
      // Units too: "12 items expiring" means something different when one
      // identity is a 10,000-unit lot (DR-01).
      .addSelect('COALESCE(SUM(i.quantity), 0)', 'units')
      .addSelect('MIN(i.expires_on)', 'soonest')
      .where('i.status = :status', { status: ItemStatus.ACTIVE })
      .andWhere('i.expires_on IS NOT NULL')
      .andWhere('i.expires_on >= :now', { now })
      .andWhere('i.expires_on <= :horizon', { horizon })
      .andWhere('i.holder_id IS NOT NULL')
      .groupBy('i.holder_id')
      .getRawMany<{ organizationId: number; count: string; soonest: string }>();

    let notified = 0;
    for (const row of rows) {
      const recipients = await this.users.find({
        where: [
          { organization: { id: row.organizationId }, role: UserRole.ORG_ADMIN },
          { organization: { id: row.organizationId }, role: UserRole.WAREHOUSE_MANAGER },
        ],
      });

      for (const recipient of recipients) {
        await this.notifications.create({
          userId: recipient.id,
          type: NotificationType.WARNING,
          title: 'Stock approaching expiry',
          message:
            `${row.count} item(s) you hold expire within ${this.nearExpiryDays} days, ` +
            `the earliest on ${formatDate(row.soonest)}. Move them first (FEFO) ` +
            'or plan for write-off.',
          module: 'inventory',
          actionUrl: '/inventory',
          // Superseded by tomorrow's notice, so it should not pile up.
          ttlDays: 2,
        });
        notified += 1;
      }
    }

    return notified;
  }

  /**
   * Marks lapsed licences EXPIRED. The read paths already judge a licence by
   * its dates, so this changes no decision - it makes the stored status agree
   * with what the system has been enforcing, which is what the regulator's
   * "expired licenses" panel reads.
   */
  private async lapseLicences(): Promise<number> {
    try {
      return await this.licenses.expireLapsed();
    } catch (error) {
      this.logger.warn(`Licence expiry sweep failed: ${(error as Error).message}`);
      return 0;
    }
  }
}

/** Adds whole days to an ISO date. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Renders a shelf date as the calendar date it actually is.
 *
 * Postgres hands a `date` column back as a string most of the time, but an
 * aggregate like MIN() arrives as a Date built at local midnight. Passing that
 * through toISOString() converts to UTC first, which moves the day backwards
 * anywhere east of Greenwich - a batch expiring on the 30th was being reported
 * to the warehouse as the 29th. A shelf date has no time and no zone, so it is
 * read back from the local components that produced it.
 */
export function formatDate(value: string | Date): string {
  if (!(value instanceof Date)) {
    return String(value).slice(0, 10);
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
