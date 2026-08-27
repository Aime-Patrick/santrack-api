import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Organization } from '../organization/entities/organization.entity';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditRecord {
  actor?: User | null;
  organization?: Organization | null;
  method: string;
  path: string;
  statusCode: number;
  detail?: string | null;
  remoteAddress?: string | null;
}

/**
 * The append-only record of privileged actions (proposal section 15). Nothing
 * here is editable; the interceptor only ever inserts, and the read endpoint
 * returns what was written. The organization an action touched is kept so an
 * administrator can ask "what did anyone do to my org", which is the question
 * an audit log exists to answer.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly logs: Repository<AuditLog>,
  ) {}

  async record(input: AuditRecord): Promise<AuditLog> {
    const log = this.logs.create({
      actor: input.actor,
      organization: input.organization ?? null,
      method: input.method,
      path: input.path,
      statusCode: input.statusCode,
      detail: input.detail ?? null,
      remoteAddress: input.remoteAddress ?? null,
    });
    return this.logs.save(log);
  }

  async recent(organizationId: number | undefined, limit: number): Promise<AuditLog[]> {
    const capped = Math.min(Math.max(limit, 1), 500);
    if (organizationId) {
      return this.logs.find({
        where: { organization: { id: organizationId } },
        order: { performedAt: 'DESC' },
        take: capped,
      });
    }
    return this.logs.find({
      order: { performedAt: 'DESC' },
      take: capped,
    });
  }

  async findById(id: number): Promise<AuditLog | null> {
    return this.logs.findOne({ where: { id } });
  }
}