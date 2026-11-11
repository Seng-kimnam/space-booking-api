import { Global, Module } from '@nestjs/common';
import { OUTBOX } from '../bookings/bookings.ports';
import { INBOX } from '../telegram/telegram.ports';
import { ConsumerRunner } from './consumers/consumer-runner';
import { SchemaValidator } from './contract/schema-validator';
import { InboxService } from './inbox/inbox.service';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { OutboxService } from './outbox/outbox.service';
import { RabbitPublisher } from './rabbitmq/rabbit-publisher';
import { RabbitConnection } from './rabbitmq/rabbitmq.connection';

/**
 * RabbitMQ, the transactional outbox and inbox, and the consumer runner
 * (docs/integration/messaging-contract.md, docs/integration/lms-message-contract.md).
 * Global because bookings, places, telegram and integrations use the ports.
 * OUTBOX and INBOX are the bookings/telegram port tokens; binding them here is
 * the wiring those port files ask for (the tokens are plain symbols).
 */
@Global()
@Module({
  providers: [
    RabbitConnection,
    RabbitPublisher,
    OutboxService,
    OutboxRelayService,
    InboxService,
    SchemaValidator,
    ConsumerRunner,
    { provide: OUTBOX, useExisting: OutboxService },
    { provide: INBOX, useExisting: InboxService },
  ],
  exports: [
    OUTBOX,
    INBOX,
    OutboxService,
    OutboxRelayService,
    InboxService,
    RabbitPublisher,
    SchemaValidator,
    ConsumerRunner,
  ],
})
export class MessagingModule {}
