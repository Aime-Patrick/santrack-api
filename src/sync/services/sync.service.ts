import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { User } from '../../auth/entities/user.entity';
import { DuplicateClientEventException } from '../../common/errors';
import {
  LifecycleDto,
  PackDto,
  RegisterPackageDto,
  RegisterUnitsDto,
  RemoveUnitDto,
  ScanDto,
} from '../../item/dto/item.dto';
import { ItemService } from '../../item/services/item.service';
import { LifecycleService } from '../../item/services/lifecycle.service';
import { Organization } from '../../organization/entities/organization.entity';
import { SellDto } from '../../sale/dto/sale.dto';
import { SaleService } from '../../sale/services/sale.service';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import {
  DispatchDto,
  ReceiveDto,
  RelocateDto,
} from '../../transfer/dto/transfer.dto';
import { TransferService } from '../../transfer/services/transfer.service';
import { SyncOperationDto, SyncOperationResult, SyncRequestDto } from '../dto/sync.dto';
import { SyncOperationType, SyncResultStatus } from '../sync.enums';

export interface SyncOutcome {
  deviceId: string;
  applied: number;
  duplicate: number;
  failed: number;
  results: SyncOperationResult[];
}

/**
 * Replays a device's queue of offline work (Core Architecture §11).
 *
 * The six steps that document describes are: operations are stored locally,
 * uploaded, validated, resolved for idempotency, confirmed individually, then
 * marked synchronised on the device. This is steps three to five - the client
 * owns the rest.
 *
 * Three decisions shape the behaviour:
 *
 * **Order is preserved.** A queue is a history, not a set. Packing precedes
 * dispatch and dispatch precedes receipt, so operations are applied in the
 * order the device recorded them and never reordered or parallelised.
 *
 * **One failure does not abort the batch.** A device may hold a day of scans;
 * refusing all of them because the fourth is bad would lose the other
 * forty-nine and give the operator nothing to act on. Every operation gets its
 * own verdict. Operations that genuinely depended on a failed one will fail in
 * turn, with their own reason, which is the honest outcome rather than a
 * silently reordered success.
 *
 * **A duplicate is a success.** Business rule 12 requires that reconnecting
 * twice never records work twice. A device told DUPLICATE has what it wanted
 * and should mark the operation done; reporting it as an error would make
 * clients retry forever.
 *
 * Each operation runs in its own transaction, inside the service that owns it.
 * There is deliberately no batch-wide transaction: a queue is a series of
 * separate physical events that already happened, and rolling back the first
 * forty because the forty-first was invalid would be rewriting history to suit
 * the upload.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly items: ItemService,
    private readonly lifecycle: LifecycleService,
    private readonly transfers: TransferService,
    private readonly sales: SaleService,
    private readonly recorder: EventRecorder,
  ) {}

  async replay(
    organization: Organization,
    actor: User,
    request: SyncRequestDto,
  ): Promise<SyncOutcome> {
    const results: SyncOperationResult[] = [];

    for (const operation of request.operations) {
      results.push(
        await this.apply(organization, actor, request.deviceId, operation),
      );
    }

    return {
      deviceId: request.deviceId,
      applied: countOf(results, SyncResultStatus.APPLIED),
      duplicate: countOf(results, SyncResultStatus.DUPLICATE),
      failed: countOf(results, SyncResultStatus.FAILED),
      results,
    };
  }

  private async apply(
    organization: Organization,
    actor: User,
    deviceId: string,
    operation: SyncOperationDto,
  ): Promise<SyncOperationResult> {
    // The queue's identity and timing are authoritative, not whatever the
    // payload happens to carry: the device knows when it scanned and which
    // operation this is, and a payload that disagreed would break replay.
    const meta = {
      clientEventId: operation.clientEventId,
      deviceId,
      occurredAt: operation.occurredAt,
    };
    const payload = { ...operation.payload, meta };

    try {
      await this.run(organization, actor, operation, payload);
      return {
        clientEventId: operation.clientEventId,
        type: operation.type,
        status: SyncResultStatus.APPLIED,
        detail: null,
      };
    } catch (error) {
      return this.describeFailure(operation, error);
    }
  }

  /** Routes one operation to the service that owns it. */
  private async run(
    organization: Organization,
    actor: User,
    operation: SyncOperationDto,
    payload: Record<string, unknown>,
  ): Promise<void> {
    switch (operation.type) {
      case SyncOperationType.REGISTER_UNITS:
        await this.items.registerUnits(
          organization,
          actor,
          await asDto(RegisterUnitsDto, payload),
        );
        return;

      case SyncOperationType.REGISTER_PACKAGE:
        await this.items.registerPackage(
          organization,
          actor,
          await asDto(RegisterPackageDto, payload),
        );
        return;

      case SyncOperationType.PACK:
        await this.items.pack(
          organization,
          actor,
          requireQrCode(operation),
          await asDto(PackDto, payload),
        );
        return;

      case SyncOperationType.OPEN_PACKAGE:
        await this.items.open(
          organization,
          actor,
          requireQrCode(operation),
          await asDto(ScanDto, payload),
        );
        return;

      case SyncOperationType.REMOVE_UNIT:
        await this.items.removeUnit(
          organization,
          actor,
          requireQrCode(operation),
          await asDto(RemoveUnitDto, payload),
        );
        return;

      case SyncOperationType.LIFECYCLE:
        await this.lifecycle.apply(
          organization,
          actor,
          requireQrCode(operation),
          await asDto(LifecycleDto, payload),
        );
        return;

      case SyncOperationType.DISPATCH:
        await this.transfers.dispatch(
          organization,
          actor,
          await asDto(DispatchDto, payload),
        );
        return;

      case SyncOperationType.RECEIVE:
        await this.transfers.receive(
          organization,
          actor,
          requireTransferId(operation),
          await asDto(ReceiveDto, payload),
        );
        return;

      case SyncOperationType.RELOCATE:
        await this.transfers.relocate(
          organization,
          actor,
          await asDto(RelocateDto, payload),
        );
        return;

      case SyncOperationType.SELL:
        await this.sales.sell(organization, actor, await asDto(SellDto, payload));
        return;
    }
  }

  /**
   * Turns a thrown error into a verdict the device can act on. A replay is
   * separated from a real failure here, because they mean opposite things to
   * the client: one is done, the other needs attention.
   */
  private describeFailure(
    operation: SyncOperationDto,
    error: unknown,
  ): SyncOperationResult {
    if (error instanceof DuplicateClientEventException) {
      const body = error.getResponse() as {
        originalEventId?: number;
        message?: string;
      };
      return {
        clientEventId: operation.clientEventId,
        type: operation.type,
        status: SyncResultStatus.DUPLICATE,
        detail: 'Already recorded on a previous upload; nothing further to do.',
        originalEventId: body?.originalEventId,
      };
    }

    const message = messageOf(error);
    this.logger.debug(
      `Sync operation ${operation.clientEventId} (${operation.type}) failed: ${message}`,
    );

    return {
      clientEventId: operation.clientEventId,
      type: operation.type,
      status: SyncResultStatus.FAILED,
      detail: message,
    };
  }
}

/**
 * Validates a queued payload against the DTO the online route uses, so a
 * device cannot reach a service with a body the HTTP endpoint would have
 * rejected. Keeping one definition per operation is the point: a parallel set
 * of sync-only rules would drift out of step the first time either changed.
 */
async function asDto<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
): Promise<T> {
  const instance = plainToInstance(cls, payload, {
    enableImplicitConversion: false,
  });
  const errors = await validate(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  if (errors.length > 0) {
    const detail = errors
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join('; ');
    throw new Error(detail || 'The operation payload is not valid');
  }
  return instance;
}

function requireQrCode(operation: SyncOperationDto): string {
  if (!operation.qrCode) {
    throw new Error(`${operation.type} needs the qrCode it acts on`);
  }
  return operation.qrCode;
}

function requireTransferId(operation: SyncOperationDto): number {
  if (operation.transferId === undefined || operation.transferId === null) {
    throw new Error('RECEIVE needs the transferId being received');
  }
  return operation.transferId;
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'getResponse' in error) {
    const body = (error as { getResponse: () => unknown }).getResponse();
    if (body && typeof body === 'object' && 'message' in body) {
      return String((body as { message: unknown }).message);
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function countOf(results: SyncOperationResult[], status: SyncResultStatus): number {
  return results.filter((result) => result.status === status).length;
}
