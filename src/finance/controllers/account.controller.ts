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
import {
  CreateAccountDto,
  UpdateAccountDto,
} from '../dto/account.dto';
import { Account } from '../entities/account.entity';
import { AccountService } from '../services/account.service';

@ApiTags('Finance - Chart of Accounts')
@ApiBearerAuth()
@Controller('api/finance/accounts')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_FINANCE)
  async create(@ActingOrg() organization: Organization, @Body() dto: CreateAccountDto) {
    return describe(await this.accounts.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    return (await this.accounts.list(organization)).map(describe);
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.accounts.get(organization, id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_FINANCE)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAccountDto,
  ) {
    return describe(await this.accounts.update(organization, id, dto));
  }
}

function describe(account: Account) {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    active: account.active,
    createdAt: account.createdAt,
  };
}