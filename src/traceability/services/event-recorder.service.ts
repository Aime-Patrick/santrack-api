import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { DuplicateClientEventException } from '../../common/errors';
import { ScanMeta, hasClientEventId, occurredAtOf } from '../../common/scan-meta';
import { Batch } from '../../batch/entities/batch.entity';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { TraceabilityEvent } from '../entities/traceability-event.entity';
import { EventType } from '../event-type.enum';

/** Everything one lifecycle event can carry. */
export interface RecordEvent {
  /** The identity this happened to. Omit for lot-level manufacturing events. */
  item?: TraceableItem | null;
  /** The lot this happened to, when no identity exists yet. */
  batch?: Batch | null;
  type: EventType;
  actor?: User | null;
  meta?: ScanMeta | null;
  sourceOrganization?: Organization | null;
  sourceLocation?: Location | null;
  destinationOrganization?: Organization | null;
  destinationLocation?: Location | null;
  relatedItem?: TraceableItem | null;
  quantity?: number | null;
  consumerRef?: string | null;
  notes?: string | null;
  compensates?: TraceabilityEvent | null;
}

/**
 * The single door through which lifecycle events enter the log. Keeping it in
 * one place means every module records the same shape of history and honours
 * the same idempotency contract.
 */
@Injectable()
export class EventRecorder {
  constructor(
    @InjectRepository(TraceabilityEvent)
    private readonly events: Repository<TraceabilityEvent>,
  ) {}

  /**
   * Appends one event. Always takes the transaction's EntityManager, so an
   * event and the state change it explains commit or roll back together -
   * history that describes a change that did not happen is worse than none.
   */
  async record(manager: EntityManager, input: RecordEvent): Promise<TraceabilityEvent> {
    requireOneSubject(input);

    const event = manager.create(TraceabilityEvent, {
      item: input.item ?? null,
      batch: input.batch ?? null,
      type: input.type,
      actor: input.actor ?? null,
      sourceOrganization: input.sourceOrganization ?? null,
      sourceLocation: input.sourceLocation ?? null,
      destinationOrganization: input.destinationOrganization ?? null,
      destinationLocation: input.destinationLocation ?? null,
      relatedItem: input.relatedItem ?? null,
      quantity: input.quantity ?? null,
      consumerRef: input.consumerRef ?? null,
      notes: input.notes ?? null,
      compensates: input.compensates ?? null,
      deviceId: input.meta?.deviceId ?? null,
      clientEventId: hasClientEventId(input.meta)
        ? (input.meta!.clientEventId as string)
        : null,
      occurredAt: occurredAtOf(input.meta),
    });
    return manager.save(TraceabilityEvent, event);
  }

  /**
   * An already-recorded event for this client id, if the device is replaying
   * a queue it had sent before.
   */
  async findReplay(meta?: ScanMeta | null): Promise<TraceabilityEvent | null> {
    if (!hasClientEventId(meta)) {
      return null;
    }
    return this.events.findOne({
      where: { clientEventId: meta!.clientEventId as string },
    });
  }

  /**
   * Rejects a replayed operation before it is applied a second time. The
   * unique index on clientEventId is the real guarantee; this check exists so
   * the client gets an answer it can act on rather than a constraint error.
   */
  async rejectReplay(meta?: ScanMeta | null): Promise<void> {
    const original = await this.findReplay(meta);
    if (original) {
      throw new DuplicateClientEventException(
        original.clientEventId as string,
        original.id,
        original.recordedAt,
      );
    }
  }
}

/**
 * Every event describes exactly one subject: a physical identity, or the lot
 * that preceded identities existing.
 *
 * Checked here as well as by the database constraint because the failure mode
 * matters. An event with neither subject is history about nothing and would
 * never surface on any timeline; an event with both would appear twice on the
 * same one, and the second copy would look like the thing happened twice.
 */
function requireOneSubject(input: RecordEvent): void {
  const hasItem = !!input.item;
  const hasBatch = !!input.batch;

  if (hasItem === hasBatch) {
    throw new Error(
      `A ${input.type} event must name either an item or a batch, not ` +
        (hasItem ? 'both' : 'neither'),
    );
  }
}
