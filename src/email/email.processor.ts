import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { SendEmailOptions } from './providers/email-provider.interface';
import { EmailProviderFactory } from './email-provider.factory';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly providerFactory: EmailProviderFactory) {
    super();
  }

  async process(job: Job<SendEmailOptions, void, string>): Promise<void> {
    this.logger.log(`Processing email job #${job.id} [${job.name}] to: ${job.data.to}`);
    const provider = this.providerFactory.getProvider();
    await provider.send(job.data);
    this.logger.log(`Delivered email job #${job.id} to: ${job.data.to}`);
  }
}
