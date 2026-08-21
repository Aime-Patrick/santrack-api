import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { SequenceService } from '../../common/sequence.service';
import { Organization } from '../../organization/entities/organization.entity';
import { isBalanced } from '../finance.enums';
import { CreateJournalEntryDto, JournalLineDto } from '../dto/journal.dto';
import { Account } from '../entities/account.entity';
import { CostCentre } from '../entities/cost-centre.entity';
import { JournalEntry, JournalLine } from '../entities/journal.entity';

@Injectable()
export class JournalService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    @InjectRepository(JournalLine)
    private readonly lines: Repository<JournalLine>,
    private readonly sequence: SequenceService,
  ) {}

  /**
   * Posts a balanced double-entry journal entry (proposal section 7). The
   * ledger never records a single-sided movement: debits must equal credits,
   * every line moves exactly one side, and the lines must reference accounts
   * that belong to the acting organization.
   */
  async create(
    organization: Organization,
    actor: User,
    dto: CreateJournalEntryDto,
  ): Promise<JournalEntry> {
    return this.dataSource.transaction(async (manager) => {
      const [debit, credit] = this.splitLines(dto.lines);
      const balance = this.balanceOf(dto.lines);
      if (!isBalanced(balance)) {
        throw new TraceabilityRuleException(
          'A journal entry must balance: debits must equal credits',
        );
      }

      const [accounts, costCentres] = await Promise.all([
        this.requireAccounts(manager, organization, [
          ...debit.map((line) => line.accountId),
          ...credit.map((line) => line.accountId),
        ]),
        this.requireCostCentres(manager, organization, [
          ...debit.map((line) => line.costCentreId).filter(isInt),
          ...credit.map((line) => line.costCentreId).filter(isInt),
        ]),
      ]);

      const entryNumber = await this.nextNumber(manager);
      const entry = await manager.save(
        manager.create(JournalEntry, {
          entryNumber,
          organization,
          description: dto.description.trim(),
          postedOn: dto.postedOn ?? null,
          createdBy: actor,
        }),
      );

      const accountById = new Map(accounts.map((account) => [account.id, account]));
      const costCentreById = new Map(
        costCentres.map((centre) => [centre.id, centre]),
      );

      const lines = await manager.save(
        JournalLine,
        dto.lines.map((line) =>
          manager.create(JournalLine, {
            entry,
            account: accountById.get(line.accountId)!,
            costCentre: line.costCentreId
              ? (costCentreById.get(line.costCentreId) ?? null)
              : null,
            debit: line.debit ?? '0',
            credit: line.credit ?? '0',
          }),
        ),
      );

      // Read back through the transaction's own manager, not through the
      // repository. The entry above was written inside this transaction and
      // has not been committed yet, so a default-connection read cannot see it
      // - `findOneOrFail` threw EntityNotFoundError on every successful post,
      // which surfaced as a 500 and made the general journal unusable.
      return manager.findOneOrFail(JournalEntry, {
        where: { id: entry.id },
        relations: { createdBy: true },
      });
    });
  }

  async list(organization: Organization): Promise<JournalEntry[]> {
    return this.entries.find({
      where: { organization: { id: organization.id } },
      order: { postedOn: 'DESC', id: 'DESC' },
      relations: { createdBy: true },
    });
  }

  async get(organization: Organization, entryId: number) {
    const entry = await this.entries.findOne({
      where: { id: entryId },
      relations: { createdBy: true },
    });
    if (!entry || entry.organization.id !== organization.id) {
      throw new NotFoundEntityException('JournalEntry', entryId);
    }
    const lines = await this.lines.find({
      where: { entry: { id: entry.id } },
      order: { id: 'ASC' },
    });
    return { entry, lines };
  }

  private splitLines(lines: JournalLineDto[]) {
    return [
      lines.filter((line) => parseFloat(line.debit ?? '0') > 0),
      lines.filter((line) => parseFloat(line.credit ?? '0') > 0),
    ];
  }

  private balanceOf(lines: JournalLineDto[]) {
    return lines.map((line) => ({
      debit: parseFloat(line.debit ?? '0'),
      credit: parseFloat(line.credit ?? '0'),
    }));
  }

  private async requireAccounts(
    manager: EntityManager,
    organization: Organization,
    ids: number[],
  ): Promise<Account[]> {
    const unique = [...new Set(ids)];
    const accounts = await manager.find(Account, {
      where: ids.map((id) => ({ id })),
    });
    const owned = accounts.filter(
      (account) => account.organization.id === organization.id,
    );
    if (owned.length !== unique.length) {
      throw new TraceabilityRuleException(
        'Every line must reference an account in your organization',
      );
    }
    return owned;
  }

  private async requireCostCentres(
    manager: EntityManager,
    organization: Organization,
    ids: number[],
  ): Promise<CostCentre[]> {
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const centres = await manager.find(CostCentre, {
      where: ids.map((id) => ({ id })),
    });
    const owned = centres.filter(
      (centre) => centre.organization.id === organization.id,
    );
    if (owned.length !== unique.length) {
      throw new TraceabilityRuleException(
        'Every line must reference a cost centre in your organization',
      );
    }
    return owned;
  }

  private async nextNumber(manager: EntityManager): Promise<string> {
    const value = await this.sequence.next(manager, 'GL');
    return `GL-${String(value).padStart(6, '0')}`;
  }
}

function isInt(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value);
}