import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { rabbitmqConfig } from '../../configuration/rabbitmq.config';
import { PoisonMessageError, SchemaValidator } from '../contract/schema-validator';
import { InboxService } from '../inbox/inbox.service';
import { PRODUCER } from '../outbox/envelope';
import { RabbitConnection } from '../rabbitmq/rabbitmq.connection';
import type { ConsumerChannel, ConsumerRoute, IncomingEnvelope } from './consumer-route';
import { deathCount } from './death-count';

/** Our dead-letter exchange: routes main -> retry, retry -> main, and DLQ copies. */
export const DLX = `${PRODUCER}.dlx`;
const PROBE_INTERVAL_MS = 30_000;

/**
 * Consumes partner events (docs/integration/messaging-contract.md section 6):
 * trust check -> envelope + schema -> inbox transaction with the handler -> ack.
 * Transient errors: nack(requeue=false); the broker parks the message in
 * <queue>.retry for RABBITMQ_RETRY_DELAY_MS and sends it back. After
 * RABBITMQ_MAX_ATTEMPTS, or for poison messages, a copy goes to <queue>.dlq.
 * The producer's message is never re-published (its user_id proof would break).
 */
@Injectable()
export class ConsumerRunner implements OnModuleDestroy {
  private readonly logger = new Logger(ConsumerRunner.name);
  private readonly channels: ChannelWrapper[] = [];
  private stopped = false;

  constructor(
    private readonly rabbit: RabbitConnection,
    private readonly schemas: SchemaValidator,
    private readonly inbox: InboxService,
    @Inject(rabbitmqConfig.KEY)
    private readonly config: ConfigType<typeof rabbitmqConfig>,
  ) {}

  /**
   * Declares the route's queues and starts consuming. Waits (and logs) while the
   * producer's exchange doesn't exist yet: we may bind to it but not declare it.
   * Never throws: the app keeps running without the consumer.
   */
  start(route: ConsumerRoute): void {
    if (!this.rabbit.isEnabled()) return;
    void this.waitForExchange(route.exchange)
      .then((ok) => {
        if (ok) this.consume(route);
      })
      .catch((err: unknown) =>
        this.logger.error(`Consumer ${route.queue} not started: ${(err as Error)?.name ?? 'unknown'}`),
      );
  }

  /** Processes one delivery. Public for tests (pass a fake channel). */
  async handle(message: ConsumeMessage, route: ConsumerRoute, channel: ConsumerChannel): Promise<void> {
    const p = message.properties;
    const attempt = deathCount(p.headers, route.queue) + 1;
    try {
      const envelope = this.parse(message, route);
      const handler = route.handlers[envelope.type];
      if (!handler) {
        this.logger.debug(`${route.queue}: ignoring ${envelope.type} ${envelope.id}`);
        channel.ack(message);
        return;
      }
      this.schemas.assertData(envelope.type, envelope.version, envelope.data);
      const fresh = await this.inbox.handleOnce(
        {
          source: envelope.source,
          messageId: envelope.id,
          eventType: envelope.type,
          // Just enough to trace it; the full payload can be large (snapshots).
          payload: { version: envelope.version, subject: envelope.subject },
        },
        (manager) => handler(manager, envelope),
      );
      if (!fresh) this.logger.debug(`${route.queue}: duplicate ${envelope.id}`);
      channel.ack(message);
    } catch (err) {
      const poison = err instanceof PoisonMessageError;
      const reason = poison ? `${err.code}: ${err.message}` : errorName(err);
      if (poison || attempt >= this.config.maxAttempts) {
        await this.deadLetter(message, route, channel, reason, attempt);
        return;
      }
      this.logger.warn(
        `${route.queue}: message ${String(p.messageId)} attempt ${attempt} failed (${reason}), retrying`,
      );
      channel.nack(message, false, false);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await Promise.all(this.channels.map((c) => c.close().catch(() => undefined)));
  }

  /** Trust check, JSON, envelope (contract section 3 and service-authentication section 3.2). */
  private parse(message: ConsumeMessage, route: ConsumerRoute): IncomingEnvelope {
    const p = message.properties;
    // user_id is validated by the broker against the publishing connection.
    if (!p.userId || p.userId !== route.producer || p.appId !== p.userId)
      throw new PoisonMessageError('UNTRUSTED_SOURCE', `user_id/app_id must both be ${route.producer}`);
    let body: unknown;
    try {
      body = JSON.parse(message.content.toString('utf-8'));
    } catch {
      throw new PoisonMessageError('INVALID_JSON', 'body is not JSON');
    }
    this.schemas.assertEnvelope(body);
    const envelope = body as IncomingEnvelope;
    if (envelope.source !== p.appId || envelope.type !== p.type || envelope.id !== p.messageId)
      throw new PoisonMessageError('ENVELOPE_MISMATCH', 'envelope does not match the AMQP properties');
    return envelope;
  }

  /** Copy to <queue>.dlq (without user_id: we can't publish as the producer), then ack. */
  private async deadLetter(
    message: ConsumeMessage,
    route: ConsumerRoute,
    channel: ConsumerChannel,
    reason: string,
    attempt: number,
  ): Promise<void> {
    const p = message.properties;
    this.logger.error(
      `${route.queue}: message ${String(p.messageId)} (${String(p.type)}) to DLQ after attempt ${attempt}: ${reason}`,
    );
    try {
      await channel.publish(DLX, `${route.dlxKey}.dlq`, message.content, {
        messageId: p.messageId,
        type: p.type,
        appId: p.appId,
        contentType: p.contentType,
        contentEncoding: p.contentEncoding,
        timestamp: p.timestamp,
        correlationId: p.correlationId,
        persistent: true,
        headers: {
          ...p.headers,
          'x-original-user-id': p.userId ?? null,
          'x-error': reason.slice(0, 500),
          'x-attempts': attempt,
        },
      });
      channel.ack(message);
    } catch (err) {
      // Not copied: keep it in the retry loop rather than lose it.
      this.logger.error(`${route.queue}: DLQ copy failed (${errorName(err)}), retrying`);
      channel.nack(message, false, false);
    }
  }

  private consume(route: ConsumerRoute): void {
    const { queue, dlxKey } = route;
    const { prefetch, retryDelayMs } = this.config;
    const channel = this.rabbit.get().createChannel({
      name: `consumer:${queue}`,
      confirm: true,
      setup: async (ch: ConfirmChannel) => {
        await ch.assertExchange(DLX, 'direct', { durable: true });
        await ch.assertQueue(queue, {
          durable: true,
          arguments: {
            'x-queue-type': 'quorum',
            'x-dead-letter-exchange': DLX,
            'x-dead-letter-routing-key': `${dlxKey}.retry`,
            // Safety net if a consumer bug requeues forever.
            'x-delivery-limit': 20,
          },
        });
        await ch.assertQueue(`${queue}.retry`, {
          durable: true,
          arguments: {
            'x-queue-type': 'quorum',
            'x-message-ttl': retryDelayMs,
            'x-dead-letter-exchange': DLX,
            'x-dead-letter-routing-key': dlxKey,
          },
        });
        await ch.assertQueue(`${queue}.dlq`, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
        await ch.bindQueue(queue, DLX, dlxKey);
        await ch.bindQueue(`${queue}.retry`, DLX, `${dlxKey}.retry`);
        await ch.bindQueue(`${queue}.dlq`, DLX, `${dlxKey}.dlq`);
        for (const key of Object.keys(route.handlers)) await ch.bindQueue(queue, route.exchange, key);
      },
    });
    channel.on('error', (err: unknown) =>
      this.logger.warn(`Consumer ${queue} setup failed: ${errorName(err)}`),
    );
    this.channels.push(channel);
    void channel
      .consume(queue, (msg) => this.handle(msg, route, channel), { prefetch })
      .then(() =>
        this.logger.log(`Consuming ${queue} (${Object.keys(route.handlers).join(', ')})`),
      )
      .catch((err: unknown) => this.logger.error(`Consumer ${queue} failed: ${errorName(err)}`));
  }

  /** Polls until the producer declared its exchange (we lack permission to declare it). */
  private async waitForExchange(exchange: string): Promise<boolean> {
    let warned = false;
    while (!this.stopped) {
      if (await this.exchangeExists(exchange)) return true;
      if (!warned) {
        this.logger.warn(`Exchange ${exchange} not declared yet; retrying every ${PROBE_INTERVAL_MS / 1000}s`);
        warned = true;
      }
      await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS).unref());
    }
    return false;
  }

  private exchangeExists(exchange: string): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = this.rabbit.get().createChannel({
        name: `probe:${exchange}`,
        setup: (ch: ConfirmChannel) => ch.checkExchange(exchange),
      });
      const done = (ok: boolean) => {
        probe.removeAllListeners();
        void probe.close().catch(() => undefined);
        resolve(ok);
      };
      probe.once('connect', () => done(true));
      probe.once('error', () => done(false));
    });
  }
}

const errorName = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 300) : 'unknown error';
