import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';
import { InvoiceStatus } from '../../commerce/commerce.enums';
import { Invoice } from '../../commerce/entities/invoice.entity';
import { AccountType, isDebitNormal } from '../finance.enums';
import { Account } from '../entities/account.entity';
import { Budget } from '../entities/budget.entity';
import { CostCentre } from '../entities/cost-centre.entity';
import { JournalEntry, JournalLine } from '../entities/journal.entity';

type Line = JournalLine & { entry: JournalEntry };

/**
 * The financial reports (proposal section 7, financial reporting). Every
 * number comes from the posted ledger - income, expenses, cash and balances
 * are the sum of the journal lines, not a spreadsheet the operator keeps in
 * step. Receivables cross into the commerce module, because an invoice that
 * exists there but not in the ledger is money the books do not yet know about.
 */
@Injectable()
export class FinanceReportService {
  constructor(
    @InjectRepository(JournalLine)
    private readonly lines: Repository<JournalLine>,
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    @InjectRepository(CostCentre)
    private readonly costCentres: Repository<CostCentre>,
    @InjectRepository(Budget)
    private readonly budgets: Repository<Budget>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
  ) {}

  /** The ledger's own totals, one row per account. */
  async trialBalance(organization: Organization) {
    const rows = await this.ledgerRows(organization);
    const byAccount = new Map<number, { debit: number; credit: number }>();
    for (const row of rows) {
      const current = byAccount.get(row.account.id) ?? { debit: 0, credit: 0 };
      current.debit += parseFloat(row.debit);
      current.credit += parseFloat(row.credit);
      byAccount.set(row.account.id, current);
    }
    const accounts = await this.accounts.find({
      where: { organization: { id: organization.id } },
      order: { code: 'ASC' },
    });
    return accounts.map((account) => {
      const totals = byAccount.get(account.id) ?? { debit: 0, credit: 0 };
      const debit = round2(totals.debit);
      const credit = round2(totals.credit);
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        debit,
        credit,
        balance: round2(isDebitNormal(account.type) ? debit - credit : credit - debit),
      };
    });
  }

  /** Revenue minus expenses for the period; the report's operating heart. */
  async profitAndLoss(organization: Organization, period?: string) {
    const rows = await this.ledgerRows(organization, period);
    const groups = {
      [AccountType.REVENUE]: 0,
      [AccountType.EXPENSE]: 0,
    } as Record<AccountType, number>;

    for (const row of rows) {
      if (row.account.type === AccountType.REVENUE) {
        groups[AccountType.REVENUE] += parseFloat(row.credit) - parseFloat(row.debit);
      } else if (row.account.type === AccountType.EXPENSE) {
        groups[AccountType.EXPENSE] += parseFloat(row.debit) - parseFloat(row.credit);
      }
    }

    const revenue = round2(groups[AccountType.REVENUE]);
    const expenses = round2(groups[AccountType.EXPENSE]);
    return {
      period: period ?? 'all',
      revenue,
      expenses,
      netIncome: round2(revenue - expenses),
    };
  }

  /** Assets and liabilities, with the retained position as the balancing line. */
  async balanceSheet(organization: Organization) {
    const rows = await this.ledgerRows(organization);
    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    for (const row of rows) {
      const debit = parseFloat(row.debit);
      const credit = parseFloat(row.credit);
      switch (row.account.type) {
        case AccountType.ASSET:
          assets += debit - credit;
          break;
        case AccountType.LIABILITY:
          liabilities += credit - debit;
          break;
        case AccountType.EQUITY:
          equity += credit - debit;
          break;
        default:
          break;
      }
    }
    assets = round2(assets);
    liabilities = round2(liabilities);
    equity = round2(equity);
    return {
      assets,
      liabilities,
      equity,
      netAssets: round2(assets - liabilities - equity),
    };
  }

  /** Actuals per cost centre, against the budget where one exists. */
  async costCentreReport(organization: Organization, period?: string) {
    const rows = await this.ledgerRows(organization, period);
    const actualByCentre = new Map<number, { debit: number; credit: number }>();
    let unattributed = { debit: 0, credit: 0 };
    for (const row of rows) {
      const bucket = row.costCentre
        ? actualByCentre.get(row.costCentre.id) ?? { debit: 0, credit: 0 }
        : unattributed;
      bucket.debit += parseFloat(row.debit);
      bucket.credit += parseFloat(row.credit);
      if (row.costCentre) actualByCentre.set(row.costCentre.id, bucket);
    }

    const centres = await this.costCentres.find({
      where: { organization: { id: organization.id } },
      order: { code: 'ASC' },
    });
    const periodSuffix = period ? { period } : {};
    const reports = centres.map((centre) => {
      const totals = actualByCentre.get(centre.id) ?? { debit: 0, credit: 0 };
      const actual = round2(totals.debit - totals.credit);
      return {
        costCentreId: centre.id,
        code: centre.code,
        name: centre.name,
        actual,
        budget: 0,
        variance: -actual,
      };
    });

    const budgetRows = await this.budgets.find({
      where: {
        organization: { id: organization.id },
        ...periodSuffix,
      },
    });
    const budgetByCentre = new Map<number, number>();
    for (const budget of budgetRows) {
      if (!budget.costCentre) continue;
      const key = budget.costCentre.id;
      budgetByCentre.set(key, (budgetByCentre.get(key) ?? 0) + parseFloat(budget.amount));
    }
    for (const report of reports) {
      report.budget = round2(budgetByCentre.get(report.costCentreId) ?? 0);
      report.variance = round2(report.budget - report.actual);
    }

    return {
      ...periodSuffix,
      costCentres: reports,
      unattributed: {
        debit: round2(unattributed.debit),
        credit: round2(unattributed.credit),
        net: round2(unattributed.debit - unattributed.credit),
      },
    };
  }

  /**
   * Accounts receivable from the commerce module: issued or partly paid
   * invoices, with what the customer still owes. Money the ledger has not yet
   * booked is still money the customer has not yet paid.
   */
  async receivables(organization: Organization) {
    const invoices = await this.invoices.find({
      where: { organization: { id: organization.id } },
      relations: { customer: true },
    });
    const receivable = invoices
      .filter(
        (invoice) =>
          invoice.status === InvoiceStatus.ISSUED ||
          invoice.status === InvoiceStatus.PARTIALLY_PAID,
      )
      .map((invoice) => ({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customer.id,
        customerName: invoice.customer.name,
        issuedOn: invoice.issuedOn,
        dueOn: invoice.dueOn,
        totalAmount: invoice.totalAmount === null ? 0 : round2(parseFloat(invoice.totalAmount)),
        amountPaid: round2(parseFloat(invoice.amountPaid)),
        balance: invoice.totalAmount === null
          ? 0
          : round2(parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid)),
      }));
    return {
      totalBalance: round2(receivable.reduce((sum, row) => sum + row.balance, 0)),
      invoices: receivable,
    };
  }

  private async ledgerRows(organization: Organization, period?: string): Promise<Line[]> {
    const builder = this.lines
      .createQueryBuilder('line')
      .innerJoinAndSelect('line.entry', 'entry')
      .innerJoinAndSelect('line.account', 'account')
      .leftJoinAndSelect('line.costCentre', 'costCentre')
      .innerJoin('entry.organization', 'org', 'org.id = :orgId', { orgId: organization.id });
    if (period) {
      builder.andWhere(`entry.posted_on LIKE :period`, { period: `${period}%` });
    }
    return builder.orderBy('entry.postedOn', 'ASC').addOrderBy('entry.id', 'ASC').getMany();
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}