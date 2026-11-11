import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { integrationsConfig } from '../../configuration/integrations.config';
import type { ExternalIdentity } from '../../external-identities/entities/external-identity.entity';
import { ExternalIdentitiesService } from '../../external-identities/external-identities.service';
import type { IncomingEnvelope } from '../../messaging/consumers/consumer-route';
import type { IdentityV1, MemberStandingChangedV1 } from '../../messaging/contract/types';
import { OutboxService } from '../../messaging/outbox/outbox.service';
import { LIBRARY_SYSTEM, LibraryRoutingKey } from './library.constants';

export interface LinkRequestResult {
  code: string;
  /** LIBRARY_LINK_URL_TEMPLATE with {code} filled in; null when not configured. */
  linkUrl: string | null;
  expiresAt: Date;
}

/**
 * Linking an LMS member to one of our users (docs/lms-integration-proposal.md
 * section 6.4): LMS asks for a one-time code (API key, identities:link), the
 * member opens it while logged in to Space Booking and confirms. Either side
 * can unlink. Every change publishes identity.linked / identity.unlinked in
 * the same transaction. Also stores member.standing_changed (phase 3).
 */
@Injectable()
export class LibraryLinksService {
  private readonly logger = new Logger(LibraryLinksService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly identities: ExternalIdentitiesService,
    private readonly outbox: OutboxService,
    @Inject(integrationsConfig.KEY)
    private readonly config: ConfigType<typeof integrationsConfig>,
  ) {}

  async requestLink(memberId: string, clientId: string): Promise<LinkRequestResult> {
    const { code, expiresAt } = await this.dataSource.transaction((m) =>
      this.identities.issueLinkCode(m, LIBRARY_SYSTEM, memberId, clientId, this.config.linkTtlMinutes),
    );
    // Member id and client only: never the code.
    this.logger.log(`Link code issued: lms member=${memberId} client=${clientId}`);
    const template = this.config.linkUrlTemplate;
    return {
      code,
      linkUrl: template ? template.replace('{code}', encodeURIComponent(code)) : null,
      expiresAt,
    };
  }

  /** The logged-in user confirms a code from LMS. 400 for unknown/used/expired, 409 if already linked. */
  async confirm(userId: string, code: string): Promise<ExternalIdentity> {
    const link = await this.dataSource.transaction(async (m) => {
      const request = await this.identities.consumeLinkCode(m, LIBRARY_SYSTEM, code);
      if (!request) throw new BadRequestException('Invalid or expired link code');
      const row = await this.identities.link(m, {
        system: LIBRARY_SYSTEM,
        externalUserId: request.externalUserId,
        userId,
        clientId: request.clientId,
      });
      await this.publish(m, row, true);
      return row;
    });
    this.logger.log(`LMS account linked: user=${userId} member=${link.externalUserId}`);
    return link;
  }

  async getForUser(userId: string): Promise<ExternalIdentity> {
    const link = await this.identities.findByUser(LIBRARY_SYSTEM, userId);
    if (!link) throw new NotFoundException('No library account linked');
    return link;
  }

  async unlinkByUser(userId: string): Promise<void> {
    const removed = await this.dataSource.transaction(async (m) => {
      const row = await this.identities.unlinkByUser(m, LIBRARY_SYSTEM, userId);
      if (row) await this.publish(m, row, false);
      return row;
    });
    if (!removed) throw new NotFoundException('No library account linked');
    this.logger.log(`LMS account unlinked by user: user=${userId} member=${removed.externalUserId}`);
  }

  async unlinkByMember(memberId: string, clientId: string): Promise<void> {
    const removed = await this.dataSource.transaction(async (m) => {
      const row = await this.identities.unlinkByMember(m, LIBRARY_SYSTEM, memberId);
      if (row) await this.publish(m, row, false);
      return row;
    });
    if (!removed) throw new NotFoundException('Member is not linked');
    this.logger.log(`LMS account unlinked by client=${clientId}: member=${memberId}`);
  }

  /** member.standing_changed handler (runs in the inbox transaction). */
  async applyStanding(manager: EntityManager, envelope: IncomingEnvelope): Promise<void> {
    const s = envelope.data as unknown as MemberStandingChangedV1;
    const outcome = await this.identities.applyStanding(manager, LIBRARY_SYSTEM, s.memberId, {
      eligible: s.eligible,
      reasons: s.reasons,
      expiryDate: s.expiryDate,
      evaluatedAt: s.evaluatedAt,
    });
    // Unlinked members are expected (LMS sends for everyone): debug, not a problem.
    if (outcome === 'unlinked') this.logger.debug(`Standing for unlinked member ${s.memberId} ignored`);
    else this.logger.log(`Member standing ${outcome}: member=${s.memberId} eligible=${s.eligible}`);
  }

  private publish(m: EntityManager, row: ExternalIdentity, linked: boolean): Promise<void> {
    const data: IdentityV1 = {
      system: LIBRARY_SYSTEM,
      memberId: row.externalUserId,
      linked,
      changedAt: new Date().toISOString(),
    };
    return this.outbox.add(m, {
      aggregateType: 'identity',
      aggregateId: row.id,
      eventType: linked ? LibraryRoutingKey.IDENTITY_LINKED : LibraryRoutingKey.IDENTITY_UNLINKED,
      payload: { schemaVersion: 1, ...data },
    });
  }
}
