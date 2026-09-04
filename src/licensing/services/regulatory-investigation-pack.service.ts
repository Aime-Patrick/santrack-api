import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecallService } from '../../recall/services/recall.service';
import { TraceabilityEvent } from '../../traceability/entities/traceability-event.entity';
import { RegulatoryInspection } from '../entities/regulatory-inspection.entity';
import { RegulatoryCaseService } from './regulatory-case.service';

export interface InvestigationPack {
  filename: string;
  contentType: string;
  body: string;
}

/** A self-contained, print-ready record of a regulatory decision. */
@Injectable()
export class RegulatoryInvestigationPackService {
  constructor(
    private readonly cases: RegulatoryCaseService,
    private readonly recalls: RecallService,
    @InjectRepository(RegulatoryInspection)
    private readonly inspections: Repository<RegulatoryInspection>,
    @InjectRepository(TraceabilityEvent)
    private readonly traceEvents: Repository<TraceabilityEvent>,
  ) {}

  async build(caseId: number): Promise<InvestigationPack> {
    const [caseRecord, events, evidence, inspections] = await Promise.all([
      this.cases.one(caseId),
      this.cases.history(caseId),
      this.cases.evidenceForCase(caseId),
      this.inspections.find({ where: { case: { id: caseId } }, order: { inspectedAt: 'ASC' } }),
    ]);
    const batch = caseRecord.batch;
    const trace = batch
      ? await this.traceEvents.find({
          where: { batch: { id: batch.id } },
          relations: { sourceOrganization: true, destinationOrganization: true, actor: true },
          order: { occurredAt: 'ASC' },
          take: 300,
        })
      : [];
    const recall = batch ? await this.recalls.impact(batch.id) : null;
    const body = renderHtml({ caseRecord, events, evidence, inspections, trace, recall });
    return {
      filename: `${caseRecord.caseNumber ?? `case-${caseId}`}-investigation-pack.html`,
      contentType: 'text/html; charset=utf-8',
      body,
    };
  }
}

function renderHtml(input: {
  caseRecord: Awaited<ReturnType<RegulatoryCaseService['one']>>;
  events: Awaited<ReturnType<RegulatoryCaseService['history']>>;
  evidence: Awaited<ReturnType<RegulatoryCaseService['evidenceForCase']>>;
  inspections: RegulatoryInspection[];
  trace: TraceabilityEvent[];
  recall: Awaited<ReturnType<RecallService['impact']>> | null;
}): string {
  const { caseRecord, events, evidence, inspections, trace, recall } = input;
  const batch = caseRecord.batch;
  const row = (label: string, value: unknown) => `<tr><th>${escape(label)}</th><td>${escape(value ?? 'Not recorded')}</td></tr>`;
  const table = (headings: string[], rows: string[][]) => rows.length === 0
    ? '<p class="empty">None recorded.</p>'
    : `<table><thead><tr>${headings.map((heading) => `<th>${escape(heading)}</th>`).join('')}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(caseRecord.caseNumber ?? `Case ${caseRecord.id}`)} investigation pack</title>
<style>
  @page { size: A4; margin: 16mm; } body { color:#18212f; font: 12px/1.45 Arial,sans-serif; margin:0; }
  h1 { margin:0; font-size:24px; } h2 { border-bottom:1px solid #b7c1cc; font-size:15px; margin:28px 0 10px; padding-bottom:5px; }
  .muted,.empty { color:#58677a; } .meta { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin:18px 0; }
  .card { border:1px solid #c8d0d9; border-radius:6px; padding:10px; } table { border-collapse:collapse; width:100%; }
  th,td { border:1px solid #c8d0d9; padding:6px 8px; text-align:left; vertical-align:top; } thead th { background:#eef3f7; }
  .summary th { width:32%; background:#f6f8fa; } .footer { border-top:1px solid #b7c1cc; color:#58677a; font-size:10px; margin-top:28px; padding-top:8px; }
  @media print { .no-print { display:none; } h2 { break-after:avoid; } table { break-inside:avoid; } }
</style></head><body>
<p class="no-print muted">Open this pack in a browser and use Print → Save as PDF for an official file.</p>
<h1>Regulatory Investigation Pack</h1><p class="muted">Generated ${escape(new Date().toLocaleString('en-GB', { timeZone: 'Africa/Kigali' }))} CAT</p>
<div class="meta"><div class="card"><strong>${escape(caseRecord.caseNumber ?? `Case ${caseRecord.id}`)}</strong><br>${escape(caseRecord.title)}<br><span class="muted">${escape(caseRecord.organization.name)}</span></div><div class="card"><strong>${escape(caseRecord.status)}</strong><br>Priority: ${escape(caseRecord.priority)}<br>Deadline: ${escape(caseRecord.dueOn ?? 'Not set')}</div></div>
<h2>Case record</h2><table class="summary"><tbody>${row('Description', caseRecord.description)}${row('Facility', caseRecord.facility?.name)}${row('Licence', caseRecord.license?.licenseNumber)}${row('Affected batch', caseRecord.batch?.batchCode)}${row('Opened by', caseRecord.openedBy ? caseRecord.openedBy.fullName ?? caseRecord.openedBy.email : 'Public scan report')}${row('Assigned officer', caseRecord.assignedTo?.fullName ?? caseRecord.assignedTo?.email)}${row('Opened', caseRecord.openedAt.toISOString())}</tbody></table>
<h2>Decision and accountability ledger</h2>${table(['When', 'Actor', 'Action'], events.map((event) => [event.recordedAt.toISOString(), event.actor ? event.actor.fullName ?? event.actor.email : 'System', event.summary]))}
<h2>Field inspections</h2>${table(['When', 'Inspector', 'Result', 'Notes'], inspections.map((inspection) => [inspection.inspectedAt.toISOString(), inspection.inspector.fullName ?? inspection.inspector.email, inspection.result, inspection.notes ?? '']))}
<h2>Corrective-action evidence</h2>${table(['Submitted', 'By', 'File', 'Note'], evidence.map((item) => [item.submittedAt.toISOString(), item.submittedBy.fullName ?? item.submittedBy.email, item.filename, item.note ?? '']))}
${recall ? `<h2>Batch and recall position</h2><table class="summary"><tbody>${row('Batch status', recall.batchStatus)}${row('Affected identities', recall.totalIdentities)}${row('Affected units', recall.totalUnits)}${row('Recoverable units', recall.recoverableUnits)}${row('Sold units', recall.soldUnits)}${row('Destroyed units', recall.destroyedUnits)}</tbody></table>${table(['Holder', 'Status', 'Identities', 'Units'], recall.holders.map((holder) => [holder.organizationName ?? 'Unknown', holder.status, String(holder.count), String(holder.units)]))}` : ''}
${batch ? `<h2>Traceability trail for ${escape(batch.batchCode)}</h2>${table(['When', 'Event', 'From', 'To', 'Actor', 'Quantity'], trace.map((event) => [event.occurredAt.toISOString(), event.type, event.sourceOrganization?.name ?? '', event.destinationOrganization?.name ?? '', event.actor ? event.actor.fullName ?? event.actor.email : 'System', event.quantity === null ? '' : String(event.quantity)]))}` : ''}
<p class="footer">SanTrack regulatory record • This pack reflects the records available when generated. Evidence files remain separately available from the protected case ledger.</p>
</body></html>`;
}

function escape(value: unknown): string {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character));
}
