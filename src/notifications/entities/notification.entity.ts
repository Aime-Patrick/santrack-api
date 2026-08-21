import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum NotificationType {
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

@Entity('notifications')
@Index('idx_notification_user', ['userId'])
@Index('idx_notification_read', ['userId', 'read'])
@Index('idx_notification_created', ['createdAt'])
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', nullable: false })
  userId: number;

  @Column({ type: 'enum', enum: NotificationType, default: NotificationType.INFO })
  type: NotificationType;

  @Column({ nullable: false })
  title: string;

  @Column({ type: 'text', nullable: false })
  message: string;

  @Column({ type: 'varchar', nullable: true })
  module: string | null;

  // The project configures no snake_case naming strategy, so every column
  // whose name differs from its property spells it out - as user_id and
  // expires_at do below.
  @Column({ name: 'action_url', type: 'varchar', nullable: true })
  actionUrl: string | null;

  @Column({ default: false })
  read: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date | null;
}
