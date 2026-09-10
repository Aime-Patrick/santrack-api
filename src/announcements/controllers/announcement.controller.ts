import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public, RequireCapability, CurrentUser, ActingOrg } from '../../common/decorators';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { AnnouncementCategory } from '../entities/announcement.entity';
import {
  AnnouncementService,
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from '../services/announcement.service';

@ApiTags('Announcements')
@Controller('api/announcements')
export class AnnouncementController {
  constructor(private readonly service: AnnouncementService) {}

  /**
   * Public endpoint — no authentication required.
   * Returns all published announcements, newest first.
   */
  @Get()
  @Public()
  list(@Query('category') category?: AnnouncementCategory) {
    return this.service.listPublished(category);
  }

  /**
   * Create a new announcement.
   * Accessible to platform operators (SYSTEM_ADMIN) and regulatory authority
   * administrators (ORG_ADMIN in a REGULATOR org). Both hold PUBLISH_ANNOUNCEMENT.
   * The author's organization is captured automatically from the JWT context.
   */
  @Post()
  @RequireCapability(Capability.PUBLISH_ANNOUNCEMENT)
  create(
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() actor: User,
    @ActingOrg() organization: Organization | null,
  ) {
    return this.service.create(
      dto,
      actor.id,
      organization?.id ?? null,
      organization?.name ?? null,
    );
  }

  /**
   * Publish an announcement — makes it live on the public page.
   */
  @Post(':id/publish')
  @HttpCode(200)
  @RequireCapability(Capability.PUBLISH_ANNOUNCEMENT)
  async publish(@Param('id', ParseIntPipe) id: number) {
    await this.service.setPublished(id, true);
    return { ok: true };
  }

  /**
   * Unpublish (retract) an announcement.
   */
  @Post(':id/unpublish')
  @HttpCode(200)
  @RequireCapability(Capability.PUBLISH_ANNOUNCEMENT)
  async unpublish(@Param('id', ParseIntPipe) id: number) {
    await this.service.setPublished(id, false);
    return { ok: true };
  }

  /**
   * Admin list — all announcements including drafts.
   * Requires PUBLISH_ANNOUNCEMENT so only operators / regulator admins can see drafts.
   */
  @Get('admin')
  @RequireCapability(Capability.PUBLISH_ANNOUNCEMENT)
  listAll() {
    return this.service.listAll();
  }

  /**
   * Update editable fields of an existing announcement (title, body, etc.).
   * Does NOT change published/unpublished state — use /publish and /unpublish for that.
   */
  @Patch(':id')
  @RequireCapability(Capability.PUBLISH_ANNOUNCEMENT)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.service.update(id, dto);
  }

  /**
   * Permanently delete an announcement (draft or published).
   */
  @Delete(':id')
  @HttpCode(204)
  @RequireCapability(Capability.PUBLISH_ANNOUNCEMENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
  }
}
