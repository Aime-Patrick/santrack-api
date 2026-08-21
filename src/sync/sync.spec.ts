import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SyncRequestDto } from './dto/sync.dto';
import { SyncOperationType, SyncResultStatus, isSettled } from './sync.enums';

async function errorsOn(payload: unknown): Promise<string[]> {
  const dto = plainToInstance(SyncRequestDto, payload);
  const errors = await validate(dto as object, { whitelist: true });
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...(error.children ?? []).flatMap((child) =>
      Object.values(child.constraints ?? {}),
    ),
    ...(error.children ?? []).flatMap((child) =>
      (child.children ?? []).flatMap((grand) =>
        Object.values(grand.constraints ?? {}),
      ),
    ),
  ]);
}

const VALID_OPERATION = {
  clientEventId: 'device-1-op-1',
  type: SyncOperationType.RELOCATE,
  occurredAt: '2026-08-18T08:00:00Z',
  payload: { destinationLocationId: 1, itemQrCodes: ['abc'] },
};

describe('sync queue envelope', () => {
  it('accepts a well-formed batch', async () => {
    expect(
      await errorsOn({ deviceId: 'device-1', operations: [VALID_OPERATION] }),
    ).toEqual([]);
  });

  it('insists on a clientEventId, which is what makes replay safe', async () => {
    // Business rule 12: without one, the server cannot recognise the same
    // operation twice and a reconnect would duplicate the work.
    const errors = await errorsOn({
      deviceId: 'device-1',
      operations: [{ ...VALID_OPERATION, clientEventId: '' }],
    });
    expect(errors.join(' ')).toMatch(/clientEventId/i);
  });

  it('insists on a deviceId', async () => {
    const errors = await errorsOn({ operations: [VALID_OPERATION] });
    expect(errors.join(' ')).toMatch(/deviceId/i);
  });

  it('rejects an unknown operation type rather than guessing', async () => {
    const errors = await errorsOn({
      deviceId: 'device-1',
      operations: [{ ...VALID_OPERATION, type: 'DROP_TABLE' }],
    });
    expect(errors.join(' ')).toMatch(/Unknown operation type/i);
  });

  it('refuses an empty batch', async () => {
    const errors = await errorsOn({ deviceId: 'device-1', operations: [] });
    expect(errors.join(' ')).toMatch(/at least one operation/i);
  });

  it('caps a batch so one upload cannot hold a connection open indefinitely', async () => {
    const operations = Array.from({ length: 501 }, (_, i) => ({
      ...VALID_OPERATION,
      clientEventId: `device-1-op-${i}`,
    }));
    const errors = await errorsOn({ deviceId: 'device-1', operations });
    expect(errors.join(' ')).toMatch(/at most 500/i);
  });

  it('rejects a field timestamp that is not a real instant', async () => {
    const errors = await errorsOn({
      deviceId: 'device-1',
      operations: [{ ...VALID_OPERATION, occurredAt: 'last tuesday' }],
    });
    expect(errors.join(' ')).toMatch(/ISO 8601/i);
  });

  it('allows a missing occurredAt, since not every client clock is trusted', async () => {
    const { occurredAt, ...withoutTime } = VALID_OPERATION;
    expect(
      await errorsOn({ deviceId: 'device-1', operations: [withoutTime] }),
    ).toEqual([]);
  });
});

describe('what counts as done', () => {
  it('treats an applied operation as settled', () => {
    expect(isSettled(SyncResultStatus.APPLIED)).toBe(true);
  });

  it('treats a duplicate as settled, not as an error', () => {
    // A device told DUPLICATE has already achieved what it wanted. Reporting
    // it as a failure would make clients retry the same operation forever.
    expect(isSettled(SyncResultStatus.DUPLICATE)).toBe(true);
  });

  it('leaves a genuine failure unsettled so it surfaces to the operator', () => {
    expect(isSettled(SyncResultStatus.FAILED)).toBe(false);
  });
});
