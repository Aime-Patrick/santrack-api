import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import {
  ActingOrg,
  CurrentUser,
  RequireCapability,
} from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import {
  AssignIdentitiesDto,
  CancelIdentitiesDto,
  ConfirmProducedDto,
  RequestIdentitiesDto,
} from '../dto/identity-pool.dto';
import { IdentityPool } from '../entities/identity-pool.entity';
import { IdentityPoolService } from '../services/identity-pool.service';

/**
 * Preparing codes for goods that have not been made yet (DR-08).
 *
 * Separate from /api/items on purpose. Everything under that path acts on
 * things that physically exist - scan it, move it, sell it - whereas nothing
 * here does. A pool is a print run of labels, and the distinction between a
 * label and a bottle is the whole reason this exists.
 */
@ApiTags('Identity Pools')
@ApiBearerAuth()
@Controller('api/identity-pools')
export class IdentityPoolController {
  constructor(private readonly pools: IdentityPoolService) {}

  /**
   * Prepare codes for a product.
   *
   * Returns as soon as the request is recorded, while minting continues behind
   * it, so the caller polls GET /:id for progress. A pool that is still
   * GENERATING is already usable: the codes that have landed are real.
   */
  @Post()
  @RequireCapability(Capability.REGISTER_IDENTITY)
  async request(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: RequestIdentitiesDto,
  ) {
    return view(await this.pools.request(organization, actor, dto));
  }

  /** Pools this organization has requested, newest first. */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('productId') productId?: string,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.pools.listFor(
      organization,
      productId ? parseInt(productId, 10) : undefined,
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 200),
    );
    return { ...result, content: result.content.map(view) };
  }

  /**
   * The pool and what became of its codes.
   *
   * One endpoint rather than two because the two are never wanted apart: the
   * question "is it finished?" and the question "how many became products?"
   * are asked by the same screen, on the same poll.
   */
  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id') id: string,
  ) {
    const poolId = parseInt(id, 10);
    const pool = await this.pools.requireOwnedPool(poolId, organization);
    return {
      ...view(pool),
      reconciliation: await this.pools.reconcile(poolId),
    };
  }

  /** Export all serial codes and QR identities as CSV */
  @Get(':id/export')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async export(
    @ActingOrg() organization: Organization,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const poolId = parseInt(id, 10);
    const { filename, csv } = await this.pools.exportCodes(poolId, organization);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  }

  /**
   * Claim codes from a pool for a production run (act 3).
   *
   * Not nested under the pool because assignment is as much about the order as
   * the pool - it is the join between them - and hanging it off one of the two
   * would suggest the other is incidental.
   */
  @Post('assign')
  @HttpCode(200)
  @RequireCapability(Capability.REGISTER_IDENTITY)
  async assign(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: AssignIdentitiesDto,
  ) {
    return this.pools.assign(organization, actor, dto);
  }

  /**
   * Turn assigned codes into product (act 4).
   *
   * This is where a code first means a bottle. Everything before it is
   * preparation, and everything the stock page shows starts here.
   */
  @Post('confirm-produced')
  @HttpCode(200)
  @RequireCapability(Capability.REGISTER_IDENTITY)
  async confirmProduced(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: ConfirmProducedDto,
  ) {
    return this.pools.confirmProduced(organization, actor, dto);
  }

  /**
   * End codes that will never name a product (acts 5 and 6).
   *
   * Takes a list because that is how it happens: an operator scans the stack
   * of labels that failed, or the tray of broken bottles, and cancels them in
   * one go with one reason. Cancelling one is the same call with one code.
   */
  @Post('cancel')
  @HttpCode(200)
  @RequireCapability(Capability.APPLY_LIFECYCLE)
  async cancel(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: CancelIdentitiesDto,
  ) {
    return this.pools.cancel(organization, actor, dto.codes, dto);
  }

  /**
   * Mint whatever is still missing.
   *
   * For a pool whose job died part way - the process restarted, the database
   * blinked. Safe to call on a healthy pool too: it counts what exists and
   * mints the gap, which for a finished pool is nothing.
   */
  @Post(':id/resume')
  @HttpCode(200)
  @RequireCapability(Capability.REGISTER_IDENTITY)
  async resume(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id') id: string,
  ) {
    const poolId = parseInt(id, 10);
    await this.pools.requireOwnedPool(poolId, organization);
    return view(await this.pools.fill(poolId, actor));
  }
}

/**
 * What a pool looks like from outside.
 *
 * `minted` is deliberately absent: it is a count over the identity table, and
 * putting it here would mean every list of twenty pools ran twenty counts. The
 * detail endpoint carries it, inside the reconciliation, where the screen that
 * needs it asks for one pool at a time.
 */
function view(pool: IdentityPool) {
  return {
    id: pool.id,
    productId: pool.product?.id ?? null,
    productName: pool.product?.name ?? null,
    productSku: pool.product?.sku ?? null,
    requestedCount: pool.requestedCount,
    status: pool.status,
    failureReason: pool.failureReason,
    requestedBy: pool.createdBy?.email ?? null,
    createdAt: pool.createdAt,
    completedAt: pool.completedAt,
  };
}
