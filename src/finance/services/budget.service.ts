import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DuplicateException, NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateBudgetDto, UpdateBudgetDto } from '../dto/budget.dto';
import { Account } from '../entities/account.entity';
import { Budget } from '../entities/budget.entity';
import { CostCentre } from '../entities/cost-centre.entity';

@Injectable()
export class BudgetService {
  constructor(
    @InjectRepository(Budget)
    private readonly budgets: Repository<Budget>,
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    @InjectRepository(CostCentre)
    private readonly costCentres: Repository<CostCentre>,
  ) {}

  async create(organization: Organization, dto: CreateBudgetDto): Promise<Budget> {
    const account = await this.requireAccount(organization, dto.accountId);
    const costCentre = dto.costCentreId
      ? await this.requireCostCentre(organization, dto.costCentreId)
      : null;

    const existing = await this.budgets.findOne({
      where: {
        organization: { id: organization.id },
        account: { id: account.id },
        costCentre: costCentre ? { id: costCentre.id } : { id: -1 },
        period: dto.period,
      },
    });
    if (existing) {
      throw new DuplicateException(
        `A budget for ${dto.period} on account ${account.code} already exists`,
      );
    }

    return this.budgets.save(
      this.budgets.create({
        organization,
        account,
        costCentre,
        period: dto.period,
        amount: String(dto.amount),
      }),
    );
  }

  async list(organization: Organization): Promise<Budget[]> {
    return this.budgets.find({
      where: { organization: { id: organization.id } },
      order: { period: 'DESC', id: 'DESC' },
    });
  }

  async update(
    organization: Organization,
    budgetId: number,
    dto: UpdateBudgetDto,
  ): Promise<Budget> {
    const budget = await this.get(organization, budgetId);
    if (dto.amount !== undefined) budget.amount = String(dto.amount);
    return this.budgets.save(budget);
  }

  async get(organization: Organization, budgetId: number): Promise<Budget> {
    const budget = await this.budgets.findOne({ where: { id: budgetId } });
    if (!budget || budget.organization.id !== organization.id) {
      throw new NotFoundEntityException('Budget', budgetId);
    }
    return budget;
  }

  private async requireAccount(organization: Organization, accountId: number) {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account || account.organization.id !== organization.id) {
      throw new NotFoundEntityException('Account', accountId);
    }
    return account;
  }

  private async requireCostCentre(organization: Organization, costCentreId: number) {
    const centre = await this.costCentres.findOne({
      where: { id: costCentreId },
    });
    if (!centre || centre.organization.id !== organization.id) {
      throw new NotFoundEntityException('CostCentre', costCentreId);
    }
    return centre;
  }
}