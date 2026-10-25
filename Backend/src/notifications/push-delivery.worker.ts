import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PushDeliveryService } from './push-delivery.service';

@Injectable()
export class PushDeliveryWorker {
  private readonly logger = new Logger(PushDeliveryWorker.name);

  constructor(private readonly deliveries: PushDeliveryService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async processQueue(): Promise<void> {
    try {
      await this.deliveries.processPendingDeliveries();
    } catch {
      // Never log payloads, subscription endpoints, keys, or provider responses.
      this.logger.warn('Push delivery queue processing failed.');
    }
  }
}
