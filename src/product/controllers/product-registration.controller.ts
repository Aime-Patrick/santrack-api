import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile as UploadedFileDecorator,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import {
  ActingOrg,
  CurrentUser,
  RequireCapability,
} from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { TraceabilityRuleException } from '../../common/errors';
import {
  ApplyForProductRegistrationDto,
  ProductDecisionDto,
} from '../dto/product-registration.dto';
import { ProductRegistrationService } from '../services/product-registration.service';
import { UploadedFile } from '../../licensing/services/license.service';

@ApiTags('Product Registrations')
@ApiBearerAuth()
@Controller('api/product-registrations')
export class ProductRegistrationController {
  constructor(private readonly service: ProductRegistrationService) {}

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    return this.service.listFor(organization);
  }

  @Get('queue')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async queue(@ActingOrg() regulator: Organization) {
    return this.service.queue(regulator);
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.get(organization, id);
  }

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async apply(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: ApplyForProductRegistrationDto,
  ) {
    return this.service.apply(organization, actor, dto);
  }

  @Post(':id/documents')
  @RequireCapability(Capability.MANAGE_CATALOG)
  @UseInterceptors(FileInterceptor('file'))
  async attachDocument(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body('documentType') documentType: string,
    @UploadedFileDecorator() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new TraceabilityRuleException('A file is required under "file"');
    }
    const uploaded: UploadedFile = {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    };
    return this.service.attachDocument(
      organization,
      actor,
      id,
      documentType,
      uploaded,
    );
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CATALOG)
  async submit(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.submit(organization, actor, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CATALOG)
  async cancel(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.cancel(organization, actor, id);
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequireCapability(Capability.DECIDE_LICENCES)
  async startReview(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.startReview(regulator, actor, id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequireCapability(Capability.DECIDE_LICENCES)
  async decide(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ProductDecisionDto,
  ) {
    return this.service.decide(regulator, actor, id, dto);
  }
}
