import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { IdentityPool } from '../entities/identity-pool.entity';
import { LabelPrintJob } from '../entities/label-print-job.entity';
import { IdentityPoolService } from '../services/identity-pool.service';

@Injectable()
export class LabelPrintJobService {
  private readonly logger = new Logger(LabelPrintJobService.name);

  constructor(
    @InjectRepository(LabelPrintJob)
    private readonly jobs: Repository<LabelPrintJob>,
    private readonly pools: IdentityPoolService,
  ) {}

  async record(
    organization: Organization,
    actor: User,
    poolId: number,
    template: string,
    quantity: number,
    renderedCount: number,
  ): Promise<LabelPrintJob> {
    const pool = await this.pools.requireOwnedPool(poolId, organization);

    const job = this.jobs.create({
      organizationId: organization.id,
      poolId: pool.id,
      template,
      quantity,
      renderedCount,
      createdById: actor.id,
    });

    return this.jobs.save(job);
  }

  async listFor(organization: Organization, page = 0, size = 50) {
    const where = { organizationId: organization.id };
    const [content, total] = await this.jobs.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: page * size,
      take: Math.min(size, 200),
    });

    return { content, total, page, size };
  }
}
