import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import type { PublishedMessageType } from './schemas';

export const PUBLISHES_KEY = 'publishesMessages';

/**
 * Documents which contract messages a route publishes (through the outbox, in
 * its transaction). Shows in Swagger as `x-publishes` on the operation and is
 * readable via Reflector. The publishing itself happens in the service; this
 * is the endpoint-level map (docs/api-endpoints.md, "Published events").
 */
export const Publishes = (...types: PublishedMessageType[]) =>
  applyDecorators(SetMetadata(PUBLISHES_KEY, types), ApiExtension('x-publishes', types));
