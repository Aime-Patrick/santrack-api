import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Notification, NotificationType } from '../entities/notification.entity';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  async create(input: {
    userId: number;
    type?: NotificationType;
    title: string;
    message: string;
    module?: string;
    actionUrl?: string;
    ttlDays?: number;
  }): Promise<Notification> {
    const expiresAt = input.ttlDays
      ? new Date(Date.now() + input.ttlDays * 86_400_000)
      : new Date(Date.now() + 30 * 86_400_000); // default 30 days

    const notification = this.repo.create({
      userId: input.userId,
      type: input.type ?? NotificationType.INFO,
      title: input.title,
      message: input.message,
      module: input.module ?? null,
      actionUrl: input.actionUrl ?? null,
      expiresAt,
    });

    return this.repo.save(notification);
  }

  async findAll(userId: number, limit = 50): Promise<Notification[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findUnread(userId: number): Promise<Notification[]> {
    return this.repo.find({
      where: { userId, read: false },
      order: { createdAt: 'DESC' },
    });
  }

  async markRead(id: number, userId: number): Promise<void> {
    await this.repo.update({ id, userId }, { read: true });
  }

  async markAllRead(userId: number): Promise<void> {
    await this.repo.update({ userId, read: false }, { read: true });
  }

  async cleanupExpired(): Promise<number> {
    const result = await this.repo.delete({
      expiresAt: LessThan(new Date()),
    });
    if (result.affected && result.affected > 0) {
      this.logger.log(`Cleaned up ${result.affected} expired notifications`);
    }
    return result.affected ?? 0;
  }

  async countUnread(userId: number): Promise<number> {
    return this.repo.count({ where: { userId, read: false } });
  }
}
