import type { DataSource, EntityManager } from 'typeorm';
import type { ExternalIdentity } from './entities/external-identity.entity';
import { ExternalIdentitiesService } from './external-identities.service';

function withLink(link: Partial<ExternalIdentity> | null) {
  const manager = {
    getRepository: () => ({ findOneBy: async () => link }),
  } as unknown as EntityManager;
  return { svc: new ExternalIdentitiesService({} as DataSource), manager };
}

const linked = (over: Partial<ExternalIdentity>): Partial<ExternalIdentity> => ({
  externalSystem: 'library',
  externalUserId: '88',
  standingEligible: true,
  standingReasons: [],
  standingExpiryDate: null,
  ...over,
});

describe('ExternalIdentitiesService.eligibility', () => {
  it('does not restrict users who never linked, or before any standing arrived', async () => {
    const a = withLink(null);
    await expect(a.svc.eligibility(a.manager, 'library', 'u', '2026-11-11')).resolves.toBeNull();
    const b = withLink(linked({ standingEligible: null }));
    await expect(b.svc.eligibility(b.manager, 'library', 'u', '2026-11-11')).resolves.toBeNull();
  });

  it('follows the LMS decision', async () => {
    const { svc, manager } = withLink(linked({ standingEligible: false, standingReasons: ['OVERDUE_ITEMS'] }));
    await expect(svc.eligibility(manager, 'library', 'u', '2026-11-11')).resolves.toEqual({
      eligible: false,
      reasons: ['OVERDUE_ITEMS'],
    });
  });

  it('treats an expiry date before place-local today as ineligible, even if LMS said eligible', async () => {
    const { svc, manager } = withLink(linked({ standingExpiryDate: '2026-11-10' }));
    await expect(svc.eligibility(manager, 'library', 'u', '2026-11-11')).resolves.toEqual({
      eligible: false,
      reasons: ['MEMBERSHIP_EXPIRED'],
    });
    await expect(svc.eligibility(manager, 'library', 'u', '2026-11-10')).resolves.toEqual({
      eligible: true,
      reasons: [],
    });
  });
});
