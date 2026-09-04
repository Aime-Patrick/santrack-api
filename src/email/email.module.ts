import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { EmailProviderFactory } from './email-provider.factory';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'email',
    }),
  ],
  providers: [EmailService, EmailProcessor, EmailProviderFactory],
  exports: [EmailService],
})
export class EmailModule {}

