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
  /** Distinct businesses that hold at least one licence issued by this authority. */
  supervisedBusinesses: number;
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

    const [activeCases, overdueCases, unassignedCases, signals] = await Promise.all([
      this.cases.count({ where: { leadAuthority: { id: authority.id }, status: Not(In(closed)) } }),
      this.cases.count({ where: { leadAuthority: { id: authority.id }, status: Not(In(closed)), dueOn: LessThan(today()) as unknown as string } }),
      this.cases.count({ where: { leadAuthority: { id: authority.id }, status: Not(In(closed)), assignedTo: IsNull() } }),
      this.signals.list(),
    ]);

    // Active recalls: only batches whose manufacturer holds a licence issued
    // by this authority — i.e. recalls this authority is responsible for.
    const activeRecalls = await this.batches
      .createQueryBuilder('batch')
      .innerJoin('batch.product', 'product')
      .innerJoin(
        'licenses',
        'lic',
        'lic.organization_id = product.organization_id AND lic.issued_by_organization_id = :orgId',
        { orgId: authority.operatingOrganization?.id ?? -1 },
      )
      .where('batch.status = :recalled', { recalled: BatchStatus.RECALLED })
      .getCount();

    // Market triage: complaints linked to a batch/product under this authority's
    // manufacturers — same licence join as recalls above.
    const marketReportsToTriage = await this.complaints
      .createQueryBuilder('complaint')
      .leftJoin('complaint.batch', 'batch')
      .leftJoin('batch.product', 'product')
      .innerJoin(
        'licenses',
        'lic',
        'lic.organization_id = product.organization_id AND lic.issued_by_organization_id = :orgId',
        { orgId: authority.operatingOrganization?.id ?? -1 },
      )
      .where('complaint.status = :triage', { triage: PublicComplaintStatus.TRIAGE })
      .getCount();

    // Count today separately in SQL so the browser's time zone cannot affect workload.
    const inspections = await this.inspections
      .createQueryBuilder('inspection')
      .innerJoin('inspection.case', 'case')
      .where('inspection.inspected_at >= :start', { start: startOfToday })
      .andWhere('case.lead_authority_id = :authorityId', { authorityId: authority.id })
      .getCount();

    // Businesses this authority has directly licensed — distinct org count.
    const supervisedResult = await this.cases.manager.query<{ count: string }[]>(
      `SELECT COUNT(DISTINCT organization_id)::int AS count
       FROM licenses
       WHERE issued_by_organization_id = $1`,
      [authority.operatingOrganization?.id ?? -1],
    );
    const supervisedBusinesses = Number(supervisedResult[0]?.count ?? 0);

    return {
      activeCases,
      overdueCases,
      unassignedCases,
      activeRecalls,
      marketReportsToTriage,
      highAttentionSignals: signals.filter((s) => s.severity === 'HIGH').length,
      inspectionsToday: inspections,
      supervisedBusinesses,
    };
  }
}
