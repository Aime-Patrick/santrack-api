import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { LifecycleAction, LifecycleDto } from '../dto/item.dto';
import { TraceableItem } from '../entities/traceable-item.entity';
import { ItemStatus } from '../item.enums';
import { ItemService, requireHeldBy } from './item.service';

/**
 * The outcomes other than a sale: quarantine, return, damage, expiry and
 * destruction. Each one changes the item status and appends an event, so a
 * product that leaves circulation still has an explanation attached to its QR.
 */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly itemService: ItemService,
    private readonly recorder: EventRecorder,
  ) {}

  async apply(
    organization: Organization,
    actor: User,
    qrCode: string,
    dto: LifecycleDto,
  ): Promise<TraceableItem> {
    await this.recorder.rejectReplay(dto.meta);

    return this.dataSource.transaction(async (manager) => {
      const item = await this.itemService.require(qrCode, manager);
      requireHeldBy(item, organization);

      if (item.status === ItemStatus.DESTROYED) {
        throw new TraceabilityRuleException(
          `${item.code} was already destroyed and has no further lifecycle`,
        );
      }

      /**
       * A release puts stock back into circulation, so it may only lift a hold
       * that a human placed. Quarantined goods have been inspected; returned
       * goods are awaiting inspection - both are legitimate things to release.
       * Nothing else is: releasing something DAMAGED or EXPIRED would be
       * overriding a physical fact with a click.
       */
      if (dto.action === LifecycleAction.RELEASE) {
        const releasable =
          item.status === ItemStatus.QUARANTINED ||
          item.status === ItemStatus.RETURNED;
        if (!releasable) {
          throw new TraceabilityRuleException(
            `${item.code} is ${item.status}, so there is no hold to release`,
          );
        }
      }

      const target = targetStatus(dto.action);
      const type = eventType(dto.action);

      // What happens to a container happens to its contents: a destroyed box
      // cannot hold intact units, and quarantine has to cover everything
      // inside or the block is meaningless.
      const affected = await this.itemService.withDescendants(manager, item);
      for (const member of affected) {
        member.status = target;
        await manager.save(TraceableItem, member);

        await this.recorder.record(manager, {
          item: member,
          type,
          actor,
          meta: member.id === item.id ? dto.meta : null,
          sourceOrganization: organization,
          sourceLocation: member.location,
          relatedItem: member.id === item.id ? null : item,
          quantity: member.quantity,
          notes: dto.reason ?? null,
        });
      }

      return this.itemService.require(item.qrCode, manager);
    });
  }
}

function targetStatus(action: LifecycleAction): ItemStatus {
  switch (action) {
    case LifecycleAction.QUARANTINE:
      return ItemStatus.QUARANTINED;
    case LifecycleAction.RELEASE:
      return ItemStatus.ACTIVE;
    case LifecycleAction.RETURN:
      return ItemStatus.RETURNED;
    case LifecycleAction.DAMAGE:
      return ItemStatus.DAMAGED;
    case LifecycleAction.EXPIRE:
      return ItemStatus.EXPIRED;
    case LifecycleAction.DESTROY:
      return ItemStatus.DESTROYED;
  }
}

function eventType(action: LifecycleAction): EventType {
  switch (action) {
    case LifecycleAction.QUARANTINE:
      return EventType.QUARANTINED;
    case LifecycleAction.RELEASE:
      return EventType.RELEASED;
    case LifecycleAction.RETURN:
      return EventType.RETURNED;
    case LifecycleAction.DAMAGE:
      return EventType.DAMAGED;
    case LifecycleAction.EXPIRE:
      return EventType.EXPIRED;
    case LifecycleAction.DESTROY:
      return EventType.DESTROYED;
  }
}
