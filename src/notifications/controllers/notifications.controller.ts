import { Controller, Get, Param, Patch, Query, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';
import { CurrentUser } from '../../common/decorators';
import { NotificationsService } from '../services/notifications.service';

/**
 * A user's own notification inbox.
 *
 * The recipient is always taken from the authenticated token, never from the
 * request. An earlier version read `?userId=` from the query string, which let
 * any signed-in account read and mutate anyone else's inbox by changing one
 * number. The WebSocket gateway alongside this controller already resolved the
 * user from the JWT payload; this is the same rule applied to the REST side.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: User, @Query('limit') limit?: string) {
    return this.notifications.findAll(user.id, boundedLimit(limit));
  }

  @Get('unread')
  async unread(@CurrentUser() user: User) {
    return this.notifications.findUnread(user.id);
  }

  @Get('count')
  async count(@CurrentUser() user: User) {
    const count = await this.notifications.countUnread(user.id);
    return { count };
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.notifications.markRead(id, user.id);
    return { success: true };
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: User) {
    await this.notifications.markAllRead(user.id);
    return { success: true };
  }
}

/**
 * Keeps a caller from asking for the whole table in one request. A missing or
 * unparseable value falls back to the default rather than erroring, because a
 * bad page size is not a reason to refuse someone their inbox.
 */
function boundedLimit(raw: string | undefined, fallback = 50, max = 200): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}
