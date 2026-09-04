import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { User } from '../../auth/entities/user.entity';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { ItemService } from '../../item/services/item.service';
import { STORAGE_PROVIDER, StorageProvider } from '../../storage/storage.provider';
import { PromotePublicComplaintDto, SubmitPublicComplaintDto } from '../dto/public-complaint.dto';
import { PublicComplaint, PublicComplaintStatus } from '../entities/public-complaint.entity';
import { RegulatoryCasePriority } from '../entities/regulatory-case.entity';
import { UploadedFile } from './license.service';
import { RegulatoryCaseService } from './regulatory-case.service';
import { RegulatoryAuthorityService } from './regulatory-authority.service';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

@Injectable()
export class PublicComplaintService {
  constructor(
    @InjectRepository(PublicComplaint) private readonly complaints: Repository<PublicComplaint>,
    private readonly itemService: ItemService,
    private readonly cases: RegulatoryCaseService,
    private readonly authorities: RegulatoryAuthorityService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async submit(dto: SubmitPublicComplaintDto, photo?: UploadedFile) {
    if (photo && (!PHOTO_TYPES.includes(photo.mimetype) || photo.size > MAX_PHOTO_BYTES)) {
      throw new TraceabilityRuleException('Attach a JPG, PNG or WebP photo no larger than 5MB');
    }
    const item = await this.itemService.findByIdentity(dto.token.trim());
    const stored = photo ? await this.storage.put({ folder: 'public-complaints', filename: photo.originalname, contentType: photo.mimetype, content: photo.buffer }) : null;
    try {
      const complaint = await this.complaints.manager.transaction(async (manager) => {
        return manager.save(manager.create(PublicComplaint, {
          token: dto.token.trim(), item, batch: item?.batch ?? null, issue: dto.issue,
          note: dto.note?.trim() || null, locationHint: dto.locationHint?.trim() || null,
          contact: dto.contact?.trim() || null, photoKey: stored?.key ?? null, photoName: photo?.originalname ?? null,
          regulatoryCase: null,
        }));
      });
      // The reference is derived from the immutable row id, so no sequence or
      // extra write is needed and it can never drift from the record it names.
      return {
        id: complaint.id,
        reference: referenceOf(complaint.id),
        receivedAt: complaint.receivedAt,
      };
    } catch (error) {
      if (stored) await this.storage.delete(stored.key);
      throw error;
    }
  }

  async listTriage(): Promise<PublicComplaint[]> {
    return this.complaints.find({ where: { status: PublicComplaintStatus.TRIAGE }, order: { receivedAt: 'DESC' }, take: 200 });
  }

  async promote(id: number, actor: User, dto: PromotePublicComplaintDto) {
    const complaint = await this.complaints.findOne({ where: { id } });
    if (!complaint) throw new NotFoundEntityException('PublicComplaint', id);
    if (complaint.status !== PublicComplaintStatus.TRIAGE) throw new TraceabilityRuleException('This report has already been reviewed');
    if (!complaint.item?.batch?.manufacturer) throw new TraceabilityRuleException('This report has no known batch to investigate; record an investigation case manually');
    if (!actor.organization) throw new TraceabilityRuleException('An active authority is required to review a report');
    const authority = await this.authorities.forOperator(actor.organization);
    const caseCategory = dto.caseCategory.trim();
    if (!authority.caseCategories.includes(caseCategory)) throw new TraceabilityRuleException('Choose a case category configured by your authority');
    const caseRecord = await this.cases.open(actor, {
      organizationId: complaint.item.batch.manufacturer.id,
      batchId: complaint.item.batch.id,
      title: `Market report: ${complaint.issue.replaceAll('_', ' ').toLowerCase()} — ${complaint.item.code}`,
      description: complaint.note ?? undefined,
      priority: RegulatoryCasePriority.HIGH,
      caseCategory,
    });
    complaint.status = PublicComplaintStatus.PROMOTED;
    complaint.regulatoryCase = caseRecord;
    complaint.reviewedBy = actor;
    complaint.reviewedAt = new Date();
    await this.complaints.save(complaint);
    return { complaint, caseRecord };
  }

  async dismiss(id: number, actor: User) {
    const complaint = await this.complaints.findOne({ where: { id } });
    if (!complaint) throw new NotFoundEntityException('PublicComplaint', id);
    if (complaint.status !== PublicComplaintStatus.TRIAGE) throw new TraceabilityRuleException('This report has already been reviewed');
    complaint.status = PublicComplaintStatus.DISMISSED;
    complaint.reviewedBy = actor;
    complaint.reviewedAt = new Date();
    return this.complaints.save(complaint);
  }

  async photoForTriage(id: number): Promise<PublicComplaint> {
    const complaint = await this.complaints.findOne({ where: { id, status: PublicComplaintStatus.TRIAGE } });
    if (!complaint || !complaint.photoKey || !complaint.photoName) throw new NotFoundEntityException('PublicComplaintPhoto', id);
    return complaint;
  }

  async photoBytes(complaint: PublicComplaint): Promise<Buffer> {
    if (!complaint.photoKey) throw new NotFoundEntityException('PublicComplaintPhoto', complaint.id);
    return this.storage.get(complaint.photoKey);
  }
}

/** RPT-000123 — the public tracking reference for a complaint row. */
export function referenceOf(id: number): string {
  return `RPT-${String(id).padStart(6, '0')}`;
}
