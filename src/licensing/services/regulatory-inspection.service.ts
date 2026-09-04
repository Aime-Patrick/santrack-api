import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { RecordRegulatoryInspectionDto } from '../dto/regulatory-inspection.dto';
import {
  RegulatoryCase,
  RegulatoryCaseEvent,
  RegulatoryCaseEventType,
  RegulatoryCaseStatus,
} from '../entities/regulatory-case.entity';
import {
  RegulatoryInspection,
  RegulatoryInspectionResult,
} from '../entities/regulatory-inspection.entity';
import { RegulatoryAuthority } from '../entities/regulatory-authority.entity';

@Injectable()
export class RegulatoryInspectionService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RegulatoryInspection)
    private readonly inspections: Repository<RegulatoryInspection>,
  ) {}

  async listForCase(caseId: number, authority: RegulatoryAuthority): Promise<RegulatoryInspection[]> {
    return this.inspections.find({
      where: { case: { id: caseId, leadAuthority: { id: authority.id } } },
      order: { inspectedAt: 'ASC' },
    });
  }

  async record(
    caseId: number,
    regulator: Organization,
    authority: RegulatoryAuthority,
    inspector: User,
    dto: RecordRegulatoryInspectionDto,
  ): Promise<RegulatoryInspection> {
    if (regulator.type !== OrganizationType.REGULATOR) {
      throw new TraceabilityRuleException('Only a regulatory authority can record a field inspection');
    }

    return this.dataSource.transaction(async (manager) => {
      const caseRecord = await manager.findOne(RegulatoryCase, { where: { id: caseId, leadAuthority: { id: authority.id } } });
      if (!caseRecord) throw new NotFoundEntityException('RegulatoryCase', caseId);
      if (caseRecord.status === RegulatoryCaseStatus.CLOSED) {
        throw new TraceabilityRuleException('A closed case cannot receive another inspection; open a new case');
      }

      const inspection = await manager.save(manager.create(RegulatoryInspection, {
        case: caseRecord,
        organization: caseRecord.organization,
        facility: caseRecord.facility,
        regulator,
        inspector,
        result: dto.result,
        notes: dto.notes?.trim() || null,
      }));

      const previous = caseRecord.status;
      const next = statusFor(dto.result);
      caseRecord.status = next;
      await manager.save(RegulatoryCase, caseRecord);

      const resultLabel = dto.result === RegulatoryInspectionResult.FAIL ? 'failed' : dto.result.toLowerCase();
      await manager.save(manager.create(RegulatoryCaseEvent, {
        case: caseRecord,
        actor: inspector,
        type: RegulatoryCaseEventType.INSPECTION_RECORDED,
        summary: `Field inspection ${resultLabel}`,
        detail: { inspectionId: inspection.id, result: dto.result, notes: inspection.notes, fromStatus: previous, toStatus: next },
      }));
      return inspection;
    });
  }
}

function statusFor(result: RegulatoryInspectionResult): RegulatoryCaseStatus {
  switch (result) {
    case RegulatoryInspectionResult.PASS:
      return RegulatoryCaseStatus.RESOLVED;
    case RegulatoryInspectionResult.CONDITIONAL:
      return RegulatoryCaseStatus.IN_PROGRESS;
    case RegulatoryInspectionResult.FAIL:
      return RegulatoryCaseStatus.AWAITING_BUSINESS;
  }
}
