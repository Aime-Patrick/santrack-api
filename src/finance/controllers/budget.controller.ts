import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateBudgetDto, UpdateBudgetDto } from '../dto/budget.dto';
import { Budget } from '../entities/budget.entity';
import { BudgetService } from '../services/budget.service';

@ApiTags('Finance - Budgets')
@ApiBearerAuth()
@Controller('api/finance/budgets')
export class BudgetController {
  constructor(private readonly budgets: BudgetService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_FINANCE)
  async create(@ActingOrg() organization: Organization, @Body() dto: CreateBudgetDto) {
    return describe(await this.budgets.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    return (await this.budgets.list(organization)).map(describe);
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_FINANCE)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBudgetDto,
  ) {
    return describe(await this.budgets.update(organization, id, dto));
  }
}

function describe(budget: Budget) {
  return {
    id: budget.id,
    accountId: budget.account.id,
    accountCode: budget.account.code,
    accountName: budget.account.name,
    costCentreId: budget.costCentre?.id ?? null,
    costCentreCode: budget.costCentre?.code ?? null,
    period: budget.period,
    amount: Number(budget.amount),
    createdAt: budget.createdAt,
  };
}