import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { RegulatoryCaseEvent } from '../entities/regulatory-case.entity';
import { LicenseEvent } from '../entities/license.entity';
import { TraceabilityEvent } from '../../traceability/entities/traceability-event.entity';

export interface AccountabilityEntry {
  id: number;
  source:
    | 'CASE'
    | 'LICENSE'
    | 'INSPECTION'
    | 'TRACEABILITY'
    | 'FINDING'
    | 'COMPLAINT';
  type: string;
  summary: string;
  detail: Record<string, unknown> | null;
  actor: string | null;
  actorEmail: string | null;
  organization: string | null;
  recordedAt: Date;
}

/**
 * Merges every event source into a single chronological timeline.
 *
 * The regulator's question is simple: "Show me everything that touched this
 * subject, who was accountable, what was decided, and what remains open."
 * This service answers it by querying every relevant table and sorting
 * the results by time.
 */
@Injectable()
export class RegulatoryAccountabilityService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Full accountability timeline for an organization.
   * Combines licence events, case events, inspections, findings, and traceability events.
   */
  async organizationTimeline(organizationId: number, limit = 50): Promise<AccountabilityEntry[]> {
    const entries: AccountabilityEntry[] = [];

    // 1. Regulatory case events
    const caseEvents = await this.dataSource
      .getRepository(RegulatoryCaseEvent)
      .createQueryBuilder('e')
      .innerJoin('e.case', 'c')
      .leftJoinAndSelect('e.actor', 'actor')
      .where('c.organization_id = :orgId', { orgId: organizationId })
      .orderBy('e.recorded_at', 'DESC')
      .take(limit)
      .getMany();

    for (const evt of caseEvents) {
      entries.push({
        id: evt.id,
        source: 'CASE',
        type: evt.type,
        summary: evt.summary,
        detail: evt.detail as Record<string, unknown> | null,
        actor: evt.actor?.fullName ?? evt.actor?.email ?? null,
        actorEmail: evt.actor?.email ?? null,
        organization: null,
        recordedAt: evt.recordedAt,
      });
    }

    // 2. License events
    const licenseEvents = await this.dataSource
      .getRepository(LicenseEvent)
      .createQueryBuilder('le')
      .innerJoin('le.license', 'l')
      .leftJoinAndSelect('le.actor', 'actor')
      .where('l.organization_id = :orgId', { orgId: organizationId })
      .orderBy('le.recorded_at', 'DESC')
      .take(limit)
      .getMany();

    for (const evt of licenseEvents) {
      entries.push({
        id: evt.id,
        source: 'LICENSE',
        type: evt.type,
        summary: buildLicenseSummary(evt),
        detail: { fromStatus: evt.fromStatus, toStatus: evt.toStatus, notes: evt.notes },
        actor: evt.actor?.fullName ?? evt.actor?.email ?? null,
        actorEmail: evt.actor?.email ?? null,
        organization: null,
        recordedAt: evt.recordedAt,
      });
    }

    // 3. Traceability events (product journey for this org)
    const traceEvents = await this.dataSource
      .getRepository(TraceabilityEvent)
      .createQueryBuilder('te')
      .leftJoinAndSelect('te.actor', 'actor')
      .leftJoinAndSelect('te.sourceOrganization', 'org')
      .where('te.source_organization_id = :orgId', { orgId: organizationId })
      .orderBy('te.occurred_at', 'DESC')
      .take(limit)
      .getMany();

    for (const evt of traceEvents) {
      entries.push({
        id: evt.id,
        source: 'TRACEABILITY',
        type: evt.type,
        summary: buildTraceSummary(evt),
        detail: { quantity: evt.quantity, notes: evt.notes },
        actor: evt.actor?.fullName ?? evt.actor?.email ?? null,
        actorEmail: evt.actor?.email ?? null,
        organization: evt.sourceOrganization?.name ?? null,
        recordedAt: evt.occurredAt,
      });
    }

    // 4. Compliance findings for this org
    const findings = await this.dataSource
      .query(
        `SELECT cf.id, cf.type, cf.summary, cf.description, cf.created_at,
                u.full_name as actor_name, u.email as actor_email
         FROM compliance_findings cf
         LEFT JOIN users u ON u.id = cf.actor_id
         WHERE cf.organization_id = $1
         ORDER BY cf.created_at DESC
         LIMIT $2`,
        [organizationId, limit],
      );

    for (const f of findings) {
      entries.push({
        id: f.id,
        source: 'FINDING',
        type: f.type,
        summary: f.summary ?? f.description ?? 'Compliance finding',
        detail: { description: f.description },
        actor: f.actor_name ?? f.actor_email ?? null,
        actorEmail: f.actor_email ?? null,
        organization: null,
        recordedAt: new Date(f.created_at),
      });
    }

    // 5. Consumer reports against this manufacturer's batches. A report is a
    // market signal the regulator has to answer for, so it belongs on the
    // business's ledger as much as an inspection does.
    const complaints = await this.dataSource.query(
      `SELECT pc.id, pc.issue, pc.status, pc.note, pc.location_hint,
              pc.reviewed_at, pc.received_at
       FROM public_complaints pc
       JOIN batches b ON b.id = pc.batch_id
       WHERE b.manufacturer_id = $1
       ORDER BY pc.received_at DESC
       LIMIT $2`,
      [organizationId, limit],
    );
    pushComplaintEntries(entries, complaints);

    // Sort all entries by time (newest first) and trim to limit
    entries.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
    return entries.slice(0, limit);
  }

  /**
   * Accountability timeline for a specific batch.
   */
  async batchTimeline(batchId: number, limit = 30): Promise<AccountabilityEntry[]> {
    const entries: AccountabilityEntry[] = [];

    // Case events linked to this batch
    const caseEvents = await this.dataSource
      .getRepository(RegulatoryCaseEvent)
      .createQueryBuilder('e')
      .innerJoin('e.case', 'c')
      .leftJoinAndSelect('e.actor', 'actor')
      .where('c.batch_id = :batchId', { batchId })
      .orderBy('e.recorded_at', 'DESC')
      .take(limit)
      .getMany();

    for (const evt of caseEvents) {
      entries.push({
        id: evt.id,
        source: 'CASE',
        type: evt.type,
        summary: evt.summary,
        detail: evt.detail as Record<string, unknown> | null,
        actor: evt.actor?.fullName ?? evt.actor?.email ?? null,
        actorEmail: evt.actor?.email ?? null,
        organization: null,
        recordedAt: evt.recordedAt,
      });
    }

    // Traceability events for this batch
    const traceEvents = await this.dataSource
      .getRepository(TraceabilityEvent)
      .createQueryBuilder('te')
      .leftJoinAndSelect('te.actor', 'actor')
      .leftJoinAndSelect('te.sourceOrganization', 'org')
      .leftJoin('te.item', 'item')
      .where('te.batch_id = :batchId OR (item.id IS NOT NULL AND item.batch_id = :batchId)', { batchId })
      .orderBy('te.occurred_at', 'DESC')
      .take(limit)
      .getMany();

    for (const evt of traceEvents) {
      entries.push({
        id: evt.id,
        source: 'TRACEABILITY',
        type: evt.type,
        summary: buildTraceSummary(evt),
        detail: { quantity: evt.quantity, notes: evt.notes },
        actor: evt.actor?.fullName ?? evt.actor?.email ?? null,
        actorEmail: evt.actor?.email ?? null,
        organization: evt.sourceOrganization?.name ?? null,
        recordedAt: evt.occurredAt,
      });
    }

    // Consumer reports against this batch - the regulator needs to see that
    // the market flagged a product before it ever reached the recall queue.
    const complaints = await this.dataSource.query(
      `SELECT pc.id, pc.issue, pc.status, pc.note, pc.location_hint,
              pc.reviewed_at, pc.received_at
       FROM public_complaints pc
       WHERE pc.batch_id = $1
       ORDER BY pc.received_at DESC
       LIMIT $2`,
      [batchId, limit],
    );
    pushComplaintEntries(entries, complaints);

    entries.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
    return entries.slice(0, limit);
  }
}

/**
 * Turns complaint rows into ledger entries: one "received" line at the report
 * time, and - when an officer has acted - a second line for the action so the
 * review history reads as a story rather than a single static status.
 */
function pushComplaintEntries(
  entries: AccountabilityEntry[],
  rows: {
    id: number;
    issue: string;
    status: string;
    note: string | null;
    location_hint: string | null;
    reviewed_at: Date | null;
    received_at: Date;
  }[],
): void {
  for (const row of rows) {
    const reference = `RPT-${String(row.id).padStart(6, '0')}`;
    const detail = {
      reference,
      issue: row.issue,
      note: row.note,
      locationHint: row.location_hint,
    };

    entries.push({
      id: row.id,
      source: 'COMPLAINT',
      type: 'COMPLAINT_RECEIVED',
      summary: `Consumer report: ${issueLabel(row.issue)} (${reference})`,
      detail,
      actor: null,
      actorEmail: null,
      organization: null,
      recordedAt: new Date(row.received_at),
    });

    if (row.status !== 'TRIAGE' && row.reviewed_at) {
      entries.push({
        id: -row.id,
        source: 'COMPLAINT',
        type: row.status, // PROMOTED or DISMISSED
        summary:
          row.status === 'PROMOTED'
            ? `Report ${reference} escalated to a regulatory case`
            : `Report ${reference} dismissed after review`,
        detail,
        actor: null,
        actorEmail: null,
        organization: null,
        recordedAt: new Date(row.reviewed_at),
      });
    }
  }
}

function issueLabel(issue: string): string {
  switch (issue) {
    case 'SUSPECTED_COUNTERFEIT':
      return 'suspected counterfeit';
    case 'ILLNESS':
      return 'illness reported';
    case 'DAMAGED':
      return 'damaged or unsafe product';
    case 'EXPIRED':
      return 'expired product';
    default:
      return issue.replace(/_/g, ' ').toLowerCase();
  }
}

function buildLicenseSummary(evt: LicenseEvent): string {
  const from = evt.fromStatus ?? 'DRAFT';
  const to = evt.toStatus ?? 'UNKNOWN';
  if (evt.notes) return `${from} → ${to}: ${evt.notes}`;
  return `${from} → ${to}`;
}

function buildTraceSummary(evt: TraceabilityEvent): string {
  const parts: string[] = [evt.type.replace(/_/g, ' ')];
  if (evt.quantity) parts.push(`${evt.quantity} units`);
  if (evt.notes) parts.push(evt.notes);
  return parts.join(' — ');
}
