import { EventType } from '../event-type.enum';
import { TraceabilityEvent } from '../entities/traceability-event.entity';

const LOT_LIFECYCLE_TYPES = new Set<string>([
  EventType.RECALLED,
  EventType.RELEASED,
]);

/**
 * Lot recalls/lifts used to write one event per unit. Timelines collapse those
 * into a single row so the ledger shows "lot recalled — N units", not a flood.
 *
 * Group key: same action + lot + actor + reason within a 10-minute window.
 * When the lot link is missing on old rows, reason+actor+window still merges them.
 */
export function collapseLotLifecycleEvents(
  events: TraceabilityEvent[],
): TraceabilityEvent[] {
  const out: TraceabilityEvent[] = [];
  const groups = new Map<string, TraceabilityEvent>();

  for (const event of events) {
    const type = String(event.type);
    if (!LOT_LIFECYCLE_TYPES.has(type)) {
      out.push(event);
      continue;
    }

    const lotId = event.batch?.id ?? event.item?.batch?.id ?? null;
    const window = Math.floor(new Date(event.occurredAt).getTime() / (10 * 60_000));
    const key = [
      type,
      lotId ?? `notes:${(event.notes ?? '').trim()}`,
      event.actor?.id ?? 'system',
      (event.notes ?? '').trim(),
      window,
    ].join('|');

    const existing = groups.get(key);
    if (!existing) {
      const summary = { ...event } as TraceabilityEvent;
      // Lot-level display: clear the unit identity so UI does not look per-code.
      summary.item = null;
      groups.set(key, summary);
      out.push(summary);
      continue;
    }

    existing.quantity = (existing.quantity ?? 0) + (event.quantity ?? 0);
    if (!existing.batch && event.batch) {
      existing.batch = event.batch;
    }
    if (!existing.batch && event.item?.batch) {
      existing.batch = event.item.batch;
    }
  }

  return out;
}
