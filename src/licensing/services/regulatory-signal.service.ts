import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BatchStatus } from '../../batch/batch-status.enum';
import { VerificationAttempt } from '../../traceability/entities/verification-attempt.entity';
import { PublicComplaint, PublicComplaintStatus } from '../entities/public-complaint.entity';

export type RegulatorySignalType = 'MATCHING_MARKET_REPORTS' | 'CLONED_LABEL_SIGNAL' | 'REPORT_ON_BLOCKED_BATCH';

export interface RegulatorySignal {
  type: RegulatorySignalType;
  severity: 'WATCH' | 'HIGH';
  title: string;
  detail: string;
  batchId: number | null;
  batchCode: string | null;
  itemCode: string | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * Derived signals for regulator attention. They create no case, change no
 * status and name no conclusion: an officer must still review the evidence.
 */
@Injectable()
export class RegulatorySignalService {
  constructor(
    @InjectRepository(PublicComplaint) private readonly complaints: Repository<PublicComplaint>,
    @InjectRepository(VerificationAttempt) private readonly attempts: Repository<VerificationAttempt>,
  ) {}

  async list(): Promise<RegulatorySignal[]> {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const complaints = await this.complaints.find({
      where: { status: PublicComplaintStatus.TRIAGE },
      order: { receivedAt: 'DESC' }, take: 500,
    });
    const signals: RegulatorySignal[] = [];
    const byBatch = new Map<number, PublicComplaint[]>();
    for (const complaint of complaints) {
      if (!complaint.batch || complaint.receivedAt < since) continue;
      const grouped = byBatch.get(complaint.batch.id) ?? [];
      grouped.push(complaint); byBatch.set(complaint.batch.id, grouped);
    }
    for (const [batchId, reports] of byBatch) {
      const batch = reports[0].batch!;
      if (reports.length >= 3) {
        signals.push({
          type: 'MATCHING_MARKET_REPORTS', severity: reports.length >= 5 ? 'HIGH' : 'WATCH',
          title: `${reports.length} matching market reports for ${batch.batchCode}`,
          detail: 'Independent public reports concern the same batch within seven days. Review the reports before opening a case.',
          batchId, batchCode: batch.batchCode, itemCode: null, count: reports.length,
          firstSeenAt: reports.at(-1)!.receivedAt, lastSeenAt: reports[0].receivedAt,
        });
      }
      if ([BatchStatus.RECALLED, BatchStatus.QUARANTINED, BatchStatus.REJECTED].includes(batch.status)) {
        signals.push({
          type: 'REPORT_ON_BLOCKED_BATCH', severity: 'HIGH',
          title: `Market report on blocked batch ${batch.batchCode}`,
          detail: `This batch is ${batch.status}. Confirm that product is not still in circulation.`,
          batchId, batchCode: batch.batchCode, itemCode: null, count: reports.length,
          firstSeenAt: reports.at(-1)!.receivedAt, lastSeenAt: reports[0].receivedAt,
        });
      }
    }

    const highScanRows = await this.attempts.find({
      where: { known: true }, relations: { item: { batch: true } }, order: { attempts: 'DESC' }, take: 100,
    });
    for (const attempt of highScanRows) {
      if (!attempt.item || attempt.lastSeenAt < since || attempt.attempts < 20) continue;
      signals.push({
        type: 'CLONED_LABEL_SIGNAL', severity: attempt.attempts >= 50 ? 'HIGH' : 'WATCH',
        title: `${attempt.attempts} public checks of one identity`,
        detail: 'This may be a display item or a copied QR label. Review its scan history before deciding.',
        batchId: attempt.item.batch?.id ?? null, batchCode: attempt.item.batch?.batchCode ?? null,
        itemCode: attempt.item.code, count: attempt.attempts,
        firstSeenAt: attempt.firstSeenAt, lastSeenAt: attempt.lastSeenAt,
      });
    }
    return signals.sort((a, b) => Number(b.severity === 'HIGH') - Number(a.severity === 'HIGH') || b.lastSeenAt.getTime() - a.lastSeenAt.getTime()).slice(0, 50);
  }
}
