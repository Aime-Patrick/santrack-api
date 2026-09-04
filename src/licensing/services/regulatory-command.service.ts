import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { BatchStatus } from '../../batch/batch-status.enum';
import { Batch } from '../../batch/entities/batch.entity';
import { today } from '../../item/entities/traceable-item.entity';
import { PublicComplaint, PublicComplaintStatus } from '../entities/public-complaint.entity';
import { RegulatoryCase, RegulatoryCaseStatus } from '../entities/regulatory-case.entity';
import { RegulatoryInspection } from '../entities/regulatory-inspection.entity';
import { RegulatoryAuthority } from '../entities/regulatory-authority.entity';
import { RegulatorySignalService } from './regulatory-signal.service';

export interface RegulatoryCommandSummary {
  activeCases: number;
  overdueCases: number;
  unassignedCases: number;
  activeRecalls: number;
  marketReportsToTriage: number;
  highAttentionSignals: number;
  inspectionsToday: number;
}

/** The handful of facts a regulator needs before deciding what to work next. */
@Injectable()
export class RegulatoryCommandService {
  constructor(
    @InjectRepository(RegulatoryCase) private readonly cases: Repository<RegulatoryCase>,
    @InjectRepository(Batch) private readonly batches: Repository<Batch>,
    @InjectRepository(PublicComplaint) private readonly complaints: Repository<PublicComplaint>,
    @InjectRepository(RegulatoryInspection) private readonly inspections: Repository<RegulatoryInspection>,
    private readonly signals: RegulatorySignalService,
  ) {}

  async summary(authority: RegulatoryAuthority): Promise<RegulatoryCommandSummary> {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const closed = [RegulatoryCaseStatus.CLOSED, RegulatoryCaseStatus.RESOLVED];
    const [activeCases, overdueCases, unassignedCases, activeRecalls, marketReportsToTriage, signals] = await Promise.all([
      this.cases.count({ where: { leadAuthority: { id: authority.id }, status: Not(In(closed)) } }),
      this.cases.count({ where: { leadAuthority: { id: authority.id }, status: Not(In(closed)), dueOn: LessThan(today()) as unknown as string } }),
      this.cases.count({ where: { leadAuthority: { id: authority.id }, status: Not(In(closed)), assignedTo: IsNull() } }),
      this.batches.count({ where: { status: BatchStatus.RECALLED } }),
      this.complaints.count({ where: { status: PublicComplaintStatus.TRIAGE } }),
      this.signals.list(),
    ]);
    // Count today separately in SQL so the browser's time zone cannot affect workload.
    const inspections = await this.inspections.createQueryBuilder('inspection').innerJoin('inspection.case', 'case').where('inspection.inspected_at >= :start', { start: startOfToday }).andWhere('case.lead_authority_id = :authorityId', { authorityId: authority.id }).getCount();
    return { activeCases, overdueCases, unassignedCases, activeRecalls, marketReportsToTriage, highAttentionSignals: signals.filter((signal) => signal.severity === 'HIGH').length, inspectionsToday: inspections };
  }
}
