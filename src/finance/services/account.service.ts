import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DuplicateException, NotFoundEntityException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateAccountDto, UpdateAccountDto } from '../dto/account.dto';
import { Account } from '../entities/account.entity';

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
  ) {}

  async create(organization: Organization, dto: CreateAccountDto): Promise<Account> {
    await this.ensureCodeFree(organization, dto.code);
    return this.accounts.save(
      this.accounts.create({
        organization,
        code: dto.code.trim(),
        name: dto.name.trim(),
        type: dto.type,
        active: dto.active ?? true,
      }),
    );
  }

  async list(organization: Organization): Promise<Account[]> {
    return this.accounts.find({
      where: { organization: { id: organization.id } },
      order: { code: 'ASC' },
    });
  }

  async get(organization: Organization, accountId: number): Promise<Account> {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account || account.organization.id !== organization.id) {
      throw new NotFoundEntityException('Account', accountId);
    }
    return account;
  }

  async update(
    organization: Organization,
    accountId: number,
    dto: UpdateAccountDto,
  ): Promise<Account> {
    const account = await this.get(organization, accountId);
    if (dto.name !== undefined) account.name = dto.name.trim();
    if (dto.type !== undefined) account.type = dto.type;
    if (dto.active !== undefined) account.active = dto.active;
    return this.accounts.save(account);
  }

  private async ensureCodeFree(organization: Organization, code: string) {
    const existing = await this.accounts.findOne({
      where: { organization: { id: organization.id }, code },
    });
    if (existing) {
      throw new DuplicateException(`An account with code ${code} already exists`);
    }
  }
}