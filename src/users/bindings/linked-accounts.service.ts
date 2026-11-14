import { Injectable } from '@nestjs/common';
import { ExternalIdentitiesService } from '../../external-identities/external-identities.service';
import { TelegramAccountsService } from '../../telegram/services/telegram-accounts.service';
import type { LinkedAccounts, LinkedAccountsPort } from '../users.ports';

/** LINKED_ACCOUNTS port: Telegram chat and partner (LMS) memberships of a user. */
@Injectable()
export class LinkedAccountsService implements LinkedAccountsPort {
  constructor(
    private readonly telegram: TelegramAccountsService,
    private readonly identities: ExternalIdentitiesService,
  ) {}

  async forUser(userId: string): Promise<LinkedAccounts> {
    const [telegram, external] = await Promise.all([
      this.telegram.getStatus(userId),
      this.identities.findForUser(userId),
    ]);
    return {
      telegram,
      external: external.map((e) => ({
        system: e.externalSystem,
        memberId: e.externalUserId,
        linkedAt: e.linkedAt,
        eligible: e.standingEligible,
      })),
    };
  }
}
