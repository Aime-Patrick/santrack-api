import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import {
  ActingOrg,
  CurrentUser,
  RequireCapability,
} from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateJournalEntryDto } from '../dto/journal.dto';
import { JournalEntry, JournalLine } from '../entities/journal.entity';
import { JournalService } from '../services/journal.service';

@ApiTags('Finance - General Journal')
@ApiBearerAuth()
@Controller('api/finance/journal')
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_FINANCE)
  async create(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: CreateJournalEntryDto,
  ) {
    const entry = await this.journal.create(organization, actor, dto);
    const { lines } = await this.journal.get(organization, entry.id);
    return describeEntry(entry, lines);
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    const entries = await this.journal.list(organization);
    return Promise.all(
      entries.map(async (entry) => {
        const { lines } = await this.journal.get(organization, entry.id);
        return describeEntry(entry, lines);
      }),
    );
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { entry, lines } = await this.journal.get(organization, id);
    return describeEntry(entry, lines);
  }
}

function describeEntry(entry: JournalEntry, lines: JournalLine[]) {
  return {
    id: entry.id,
    entryNumber: entry.entryNumber,
    description: entry.description,
    postedOn: entry.postedOn,
    createdById: entry.createdBy?.id ?? null,
    createdAt: entry.createdAt,
    lines: lines.map((line) => ({
      accountId: line.account.id,
      accountCode: line.account.code,
      accountName: line.account.name,
      costCentreId: line.costCentre?.id ?? null,
      costCentreCode: line.costCentre?.code ?? null,
      debit: Number(line.debit),
      credit: Number(line.credit),
    })),
  };
}