import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import { rabbitmqConfig } from '../../configuration/rabbitmq.config';
import type { OutgoingMessage } from '../outbox/envelope';
import { RabbitConnection } from './rabbitmq.connection';

/**
 * Publishes to our exchange on a confirm channel. Off when RABBITMQ_URL is empty.
 * The channel setup declares `space-booking.events` (the producer owns its exchange).
 */
@Injectable()
export class RabbitPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitPublisher.name);
  private channel?: ChannelWrapper;

  constructor(
    private readonly rabbit: RabbitConnection,
    @Inject(rabbitmqConfig.KEY)
    private readonly config: ConfigType<typeof rabbitmqConfig>,
  ) {}

  isEnabled(): boolean {
    return this.rabbit.isEnabled();
  }

  onModuleInit(): void {
    if (!this.isEnabled()) {
      this.logger.log('RABBITMQ_URL is empty: messaging is off, outbox rows stay unpublished');
      return;
    }
    const { exchange, publishTimeoutMs } = this.config;
    this.channel = this.rabbit.get().createChannel({
      name: 'publisher',
      confirm: true,
      publishTimeout: publishTimeoutMs,
      setup: (ch: ConfirmChannel) => ch.assertExchange(exchange, 'topic', { durable: true }),
    });
    this.channel.on('error', (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Publisher channel error: ${e.message}`, e.stack);
    });
  }

  /** Resolves once the broker confirmed the message; rejects on nack, timeout or no connection. */
  async publishConfirmed(message: OutgoingMessage): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ publisher is disabled');
    // Fail fast instead of buffering until publishTimeout: the relay keeps the row and retries.
    if (!this.rabbit.isConnected()) throw new Error('RabbitMQ is not connected');
    await this.channel.publish(
      this.config.exchange,
      message.routingKey,
      Buffer.from(JSON.stringify(message.body), 'utf-8'),
      message.properties,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
  }
}
