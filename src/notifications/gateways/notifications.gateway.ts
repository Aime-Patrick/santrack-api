import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { NotificationsService } from '../services/notifications.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly connectedUsers = new Map<number, string>(); // userId → socketId

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token ?? client.handshake.query?.token;
      if (!token || typeof token !== 'string') {
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token);
      const userId = payload.sub ?? payload.userId ?? payload.id;
      if (!userId) {
        client.disconnect();
        return;
      }

      client.data.userId = userId;
      this.connectedUsers.set(userId, client.id);
      client.join(`user_${userId}`);

      this.logger.log(`User ${userId} connected via WebSocket`);

      // Send unread count on connect
      const unread = await this.notificationsService.countUnread(userId);
      client.emit('unread_count', { count: unread });
    } catch {
      this.logger.warn('WebSocket connection rejected: invalid token');
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      this.connectedUsers.delete(userId);
      this.logger.log(`User ${userId} disconnected`);
    }
  }

  @SubscribeMessage('get_unread')
  async handleGetUnread(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    if (!userId) return;
    const count = await this.notificationsService.countUnread(userId);
    client.emit('unread_count', { count });
  }

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { notificationId: number },
  ) {
    const userId = client.data.userId;
    if (!userId) return;
    await this.notificationsService.markRead(data.notificationId, userId);
    const count = await this.notificationsService.countUnread(userId);
    client.emit('unread_count', { count });
  }

  @SubscribeMessage('mark_all_read')
  async handleMarkAllRead(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    if (!userId) return;
    await this.notificationsService.markAllRead(userId);
    client.emit('unread_count', { count: 0 });
  }

  /** Called by services to push a notification to a specific user. */
  async sendToUser(userId: number, notification: {
    type: string;
    title: string;
    message: string;
    module?: string;
    actionUrl?: string;
  }) {
    const saved = await this.notificationsService.create({
      userId,
      type: notification.type as any,
      title: notification.title,
      message: notification.message,
      module: notification.module,
      actionUrl: notification.actionUrl,
    });

    this.server.to(`user_${userId}`).emit('notification', saved);
    const count = await this.notificationsService.countUnread(userId);
    this.server.to(`user_${userId}`).emit('unread_count', { count });
  }

  /** Broadcast to all connected users. */
  async broadcast(notification: {
    type: string;
    title: string;
    message: string;
    module?: string;
    actionUrl?: string;
  }) {
    this.server.emit('notification', notification);
  }
}
