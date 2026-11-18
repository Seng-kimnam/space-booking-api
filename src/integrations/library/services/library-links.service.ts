import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { integrationsConfig } from '../../../configuration/integrations.config';
import type { ExternalIdentity } from '../../../external-identities/entities/external-identity.entity';
import { ExternalIdentitiesService } from '../../../external-identities/external-identities.service';
import type { IncomingEnvelope } from '../../../messaging/consumers/consumer-route';
import type { IdentityV1, MemberStandingChangedV1 } from '../../../messaging/contract/types';
import { MessageType } from '../../../messaging/contract/schemas';
import { OutboxService } from '../../../messaging/outbox/outbox.service';
import { LIBRARY_SYSTEM } from '../library.constants';

export interface LinkRequestResult {
  code: string;
  /** LIBRARY_LINK_URL_TEMPLATE with {code} filled in; null when not configured. */
  linkUrl: string | null;
  expiresAt: Date;
}

/**
 * Links an LMS member to one of our users with a one-time code, and stores
 * member standing. Every link change publishes identity.* in the same transaction.
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

  /** 400 for an unknown, used or expired code; 409 if already linked. */
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
    const removed = await this.unlinkAndPublish((m) => this.identities.unlinkByUser(m, LIBRARY_SYSTEM, userId));
    if (!removed) throw new NotFoundException('No library account linked');
    this.logger.log(`LMS account unlinked by user: user=${userId} member=${removed.externalUserId}`);
  }

  async unlinkByMember(memberId: string, clientId: string): Promise<void> {
    const removed = await this.unlinkAndPublish((m) => this.identities.unlinkByMember(m, LIBRARY_SYSTEM, memberId));
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
    // LMS sends standing for every member, so unlinked ones are normal.
    if (outcome === 'unlinked') this.logger.debug(`Standing for unlinked member ${s.memberId} ignored`);
    else this.logger.log(`Member standing ${outcome}: member=${s.memberId} eligible=${s.eligible}`);
  }

  private unlinkAndPublish(
    unlink: (m: EntityManager) => Promise<ExternalIdentity | null>,
  ): Promise<ExternalIdentity | null> {
    return this.dataSource.transaction(async (m) => {
      const row = await unlink(m);
      if (row) await this.publish(m, row, false);
      return row;
    });
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
      eventType: linked ? MessageType.IDENTITY_LINKED : MessageType.IDENTITY_UNLINKED,
      payload: { schemaVersion: 1, ...data },
    });
  }
}
