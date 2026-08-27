import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import {
  ActingOrg,
  CurrentUser,
  RequireCapability,
} from '../../common/decorators';
import { view } from '../../item/controllers/item.controller';
import { Organization } from '../../organization/entities/organization.entity';
import { DispatchDto, ReceiveDto, RelocateDto } from '../dto/transfer.dto';
import { Transfer, TransferLine } from '../entities/transfer.entity';
import { TransferService } from '../services/transfer.service';

@ApiTags('Transfers')
@ApiBearerAuth()
@Controller('api/transfers')
export class TransferController {
  constructor(private readonly transfers: TransferService) {}

  @Post()
  @RequireCapability(Capability.MOVE_STOCK)
  async dispatch(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: DispatchDto,
  ) {
    const transfer = await this.transfers.dispatch(organization, actor, dto);
    return describe(transfer, await this.transfers.findLines(transfer.id));
  }

  @Post(':id/receive')
  @HttpCode(200)
  @RequireCapability(Capability.MOVE_STOCK)
  async receive(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto?: ReceiveDto,
  ) {
    const { transfer, lines, missing } = await this.transfers.receive(
      organization,
      actor,
      id,
      dto,
    );
    return describe(transfer, lines, missing);
  }

  /**
   * Moves stock between the caller's own locations. Not a transfer: custody
   * never leaves the organization, so there is no second party to confirm.
   */
  @Post('relocate')
  @HttpCode(200)
  @RequireCapability(Capability.MOVE_STOCK)
  async relocate(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: RelocateDto,
  ) {
    const moved = await this.transfers.relocate(organization, actor, dto);
    return { movedCount: moved.length, items: moved.map((i) => view(i, false)) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireCapability(Capability.MOVE_STOCK)
  async cancel(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const transfer = await this.transfers.cancel(organization, actor, id);
    return describe(transfer, await this.transfers.findLines(transfer.id));
  }

  /**
   * Transfers the caller's organization sent, or - with direction=incoming -
   * those addressed to it. Kept as one endpoint with a direction parameter
   * because that is the shape existing clients already call; /outgoing and
   * /incoming below are the clearer aliases for new ones.
   */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('direction') direction = 'outgoing',
    @Query('pendingOnly') pendingOnly = 'false',
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    return direction.toLowerCase() === 'incoming'
      ? this.incoming(organization, pendingOnly, page, size)
      : this.outgoing(organization, page, size);
  }

  @Get('outgoing')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async outgoing(
    @ActingOrg() organization: Organization,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.transfers.listOutgoing(
      organization,
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 100),
    );
    const counts = await this.transfers.lineCounts(
      result.content.map((transfer) => transfer.id),
    );
    return {
      ...result,
      content: result.content.map((transfer) =>
        describe(transfer, [], [], counts.get(transfer.id) ?? 0),
      ),
    };
  }

  @Get('incoming')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async incoming(
    @ActingOrg() organization: Organization,
    @Query('pendingOnly') pendingOnly = 'false',
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.transfers.listIncoming(
      organization,
      pendingOnly === 'true',
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 100),
    );
    const counts = await this.transfers.lineCounts(
      result.content.map((transfer) => transfer.id),
    );
    return {
      ...result,
      content: result.content.map((transfer) =>
        describe(transfer, [], [], counts.get(transfer.id) ?? 0),
      ),
    };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const transfer = await this.transfers.get(organization, id);
    return describe(transfer, await this.transfers.findLines(id));
  }
}

function describe(
  transfer: Transfer,
  lines: TransferLine[],
  missing: string[] = [],
  lineCount = lines.length,
) {
  return {
    id: transfer.id,
    reference: transfer.reference,
    status: transfer.status,
    sourceOrganizationId: transfer.sourceOrganization.id,
    sourceOrganizationName: transfer.sourceOrganization.name,
    sourceLocationName: transfer.sourceLocation?.name ?? null,
    destinationOrganizationId: transfer.destinationOrganization.id,
    destinationOrganizationName: transfer.destinationOrganization.name,
    destinationLocationName: transfer.destinationLocation?.name ?? null,
    dispatchedAt: transfer.dispatchedAt,
    receivedAt: transfer.receivedAt,
    notes: transfer.notes,
    lineCount,
    lines: lines.map((line) => ({
      id: line.id,
      itemId: line.item.id,
      itemCode: line.item.code,
      itemQrCode: line.item.qrCode,
      quantity: line.item.quantity,
    })),
    /** Dispatched but not scanned back at receipt. */
    missing,
  };
}
