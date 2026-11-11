import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as amqp from 'amqp-connection-manager';
import type { AmqpConnectionManager } from 'amqp-connection-manager';
import { rabbitmqConfig } from '../../configuration/rabbitmq.config';

/**
 * The one RabbitMQ connection of this process, created on first use. Off when
 * RABBITMQ_URL is empty. `amqp-connection-manager` reconnects by itself and
 * re-runs every channel's setup. Never logs the URL: it holds the password.
 */
@Injectable()
export class RabbitConnection implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitConnection.name);
  private manager?: AmqpConnectionManager;

  constructor(
    @Inject(rabbitmqConfig.KEY)
    private readonly config: ConfigType<typeof rabbitmqConfig>,
  ) {}

  isEnabled(): boolean {
    return this.config.url !== '';
  }

  isConnected(): boolean {
    return this.manager?.isConnected() ?? false;
  }

  get(): AmqpConnectionManager {
    if (!this.isEnabled()) throw new Error('RabbitMQ is disabled (RABBITMQ_URL is empty)');
    if (!this.manager) {
      this.manager = amqp.connect([this.config.url], {
        connectionOptions: { clientProperties: { connection_name: 'space-booking-api' } },
      });
      this.manager.on('connect', () => this.logger.log('Connected to RabbitMQ'));
      this.manager.on('disconnect', ({ err }) =>
        this.logger.warn(`Disconnected from RabbitMQ: ${describe(err)}`),
      );
      this.manager.on('connectFailed', ({ err }) =>
        this.logger.warn(`RabbitMQ connection failed: ${describe(err)}`),
      );
    }
    return this.manager;
  }

  async onModuleDestroy(): Promise<void> {
    await this.manager?.close().catch(() => undefined);
  }
}

/**
 * The broker's reason (e.g. ECONNREFUSED, 403 ACCESS-REFUSED, vhost not found),
 * with any amqp://user:password@ removed so credentials never reach the log.
 */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  return `${err.name}: ${err.message}`.replace(/amqps?:\/\/[^@\s]*@/gi, 'amqp://***@').slice(0, 300);
}
