import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { isPgError, PG_UNIQUE_VIOLATION } from '../common/utils/db-errors';
import { ExternalIdentity } from './entities/external-identity.entity';
import { ExternalLinkRequest } from './entities/external-link-request.entity';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface MemberStanding {
  eligible: boolean;
  reasons: string[];
  expiryDate: string | null;
  evaluatedAt: string;
}

export type StandingOutcome = 'applied' | 'stale' | 'unlinked';

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
}

/**
 * Links our users to partner accounts via one-time codes, never by email (D11).
 * Writes take the caller's `manager` so outbox rows join the same transaction.
 */
@Injectable()
export class ExternalIdentitiesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Every partner link of a user (users module: linked accounts). */
  findForUser(userId: string): Promise<ExternalIdentity[]> {
    return this.dataSource
      .getRepository(ExternalIdentity)
      .find({ where: { userId }, order: { linkedAt: 'ASC' } });
  }

  /** New single-use code for a partner member; older live codes for that member stop working. */
  async issueLinkCode(
    manager: EntityManager,
    system: string,
    externalUserId: string,
    clientId: string | null,
    ttlMinutes: number,
  ): Promise<{ code: string; expiresAt: Date }> {
    await manager
      .createQueryBuilder()
      .update(ExternalLinkRequest)
      .set({ usedAt: () => 'now()' })
      .where('external_system = :system AND external_user_id = :id AND used_at IS NULL', {
        system,
        id: externalUserId,
      })
      .execute();
    // 32 chars, URL-safe: goes into a link the member opens.
    const code = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    await manager.insert(ExternalLinkRequest, {
      externalSystem: system,
      externalUserId,
      clientId,
      codeHash: sha256(code),
      expiresAt,
    });
    return { code, expiresAt };
  }

  /** Marks the code used (atomically) and returns whom it was for; null if unknown, used or expired. */
  async consumeLinkCode(
    manager: EntityManager,
    system: string,
    code: string,
  ): Promise<{ externalUserId: string; clientId: string | null } | null> {
    const result = await manager
      .createQueryBuilder()
      .update(ExternalLinkRequest)
      .set({ usedAt: () => 'now()' })
      .where('code_hash = :hash AND external_system = :system', { hash: sha256(code), system })
      .andWhere('used_at IS NULL AND expires_at > now()')
      // Property paths, not column names: TypeORM resolves them to the entity
      // columns for RETURNING and the raw rows still come back snake_case.
      .returning(['externalUserId', 'clientId'])
      .execute();
    const row = (result.raw as { external_user_id: string; client_id: string | null }[])[0];
    return row ? { externalUserId: row.external_user_id, clientId: row.client_id } : null;
  }

  /** 409 if the user or the member is already linked in this system. */
  async link(
    manager: EntityManager,
    link: { system: string; externalUserId: string; userId: string; clientId: string | null },
  ): Promise<ExternalIdentity> {
    const repo = manager.getRepository(ExternalIdentity);
    const existing = await repo.findOne({
      where: [
        { externalSystem: link.system, userId: link.userId },
        { externalSystem: link.system, externalUserId: link.externalUserId },
      ],
    });
    if (existing?.userId === link.userId && existing.externalUserId === link.externalUserId) return existing;
    if (existing)
      throw new ConflictException(
        existing.userId === link.userId
          ? 'Your account is already linked to another library member; unlink it first'
          : 'This library member is already linked to another account',
      );
    try {
      return await repo.save(
        repo.create({
          externalSystem: link.system,
          externalUserId: link.externalUserId,
          userId: link.userId,
          clientId: link.clientId,
        }),
      );
    } catch (err) {
      // A concurrent link of the same user or member.
      if (isPgError(err, PG_UNIQUE_VIOLATION)) throw new ConflictException('Already linked');
      throw err;
    }
  }

  findByUser(system: string, userId: string, manager?: EntityManager): Promise<ExternalIdentity | null> {
    return (manager ?? this.dataSource.manager)
      .getRepository(ExternalIdentity)
      .findOneBy({ externalSystem: system, userId });
  }

  /** Deletes the link and returns it, or null if there was none. */
  unlinkByUser(manager: EntityManager, system: string, userId: string): Promise<ExternalIdentity | null> {
    return this.unlink(manager, { externalSystem: system, userId });
  }

  unlinkByMember(manager: EntityManager, system: string, externalUserId: string): Promise<ExternalIdentity | null> {
    return this.unlink(manager, { externalSystem: system, externalUserId });
  }

  /** userId -> partner member id, for the users that are linked. */
  async memberIdsForUsers(manager: EntityManager, system: string, userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await manager
      .getRepository(ExternalIdentity)
      .createQueryBuilder('e')
      .select(['e.userId', 'e.externalUserId'])
      .where('e.externalSystem = :system AND e.userId IN (:...userIds)', { system, userIds: [...new Set(userIds)] })
      .getMany();
    return new Map(rows.map((r) => [r.userId, r.externalUserId]));
  }

  /** Stores a member's standing if it is newer than what we have. Unlinked members are ignored. */
  async applyStanding(
    manager: EntityManager,
    system: string,
    externalUserId: string,
    standing: MemberStanding,
  ): Promise<StandingOutcome> {
    const result = await manager
      .createQueryBuilder()
      .update(ExternalIdentity)
      .set({
        standingEligible: standing.eligible,
        standingReasons: standing.reasons,
        standingExpiryDate: standing.expiryDate,
        standingEvaluatedAt: new Date(standing.evaluatedAt),
      })
      .where('external_system = :system AND external_user_id = :id', { system, id: externalUserId })
      .andWhere('(standing_evaluated_at IS NULL OR standing_evaluated_at < :at)', { at: standing.evaluatedAt })
      .execute();
    if ((result.affected ?? 0) > 0) return 'applied';
    const linked = await manager
      .getRepository(ExternalIdentity)
      .exists({ where: { externalSystem: system, externalUserId } });
    return linked ? 'stale' : 'unlinked';
  }

  /**
   * Whether a user may make new bookings at a partner place (D10). Null (allowed)
   * when not linked or no standing yet. `today` is the place-local YYYY-MM-DD.
   */
  async eligibility(
    manager: EntityManager,
    system: string,
    userId: string,
    today: string,
  ): Promise<Eligibility | null> {
    const link = await this.findByUser(system, userId, manager);
    if (!link || link.standingEligible === null) return null;
    const reasons = [...link.standingReasons];
    let eligible = link.standingEligible;
    if (link.standingExpiryDate && link.standingExpiryDate < today) {
      eligible = false;
      if (!reasons.includes('MEMBERSHIP_EXPIRED')) reasons.push('MEMBERSHIP_EXPIRED');
    }
    return { eligible, reasons };
  }

  private async unlink(
    manager: EntityManager,
    where: Partial<Pick<ExternalIdentity, 'externalSystem' | 'userId' | 'externalUserId'>>,
  ): Promise<ExternalIdentity | null> {
    const repo = manager.getRepository(ExternalIdentity);
    const row = await repo.findOneBy(where);
    if (!row) return null;
    await repo.delete({ id: row.id });
    return row;
  }
}
