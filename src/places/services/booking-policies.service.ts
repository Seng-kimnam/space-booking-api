import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { BookingPolicyDto } from '../dto/booking-policy.dto';
import { BookingPolicy } from '../entities/booking-policy.entity';

/** booking_policies: one row per place, created with the place. */
@Injectable()
export class BookingPoliciesService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  findByPlace(
    placeId: string,
    manager?: EntityManager,
  ): Promise<BookingPolicy | null> {
    return (manager ?? this.ds.manager)
      .getRepository(BookingPolicy)
      .findOneBy({ placeId });
  }

  /** Inserts the place's policy; fields not in `dto` take the column defaults. */
  async create(
    manager: EntityManager,
    placeId: string,
    dto: BookingPolicyDto = {},
  ): Promise<BookingPolicy> {
    const repo = manager.getRepository(BookingPolicy);
    // create() applies no column defaults, so merge onto a defaults row to
    // validate the cross-field rules before Postgres sees it.
    const policy = repo.create({
      ...policyDefaults(),
      ...definedFields(dto),
      placeId,
    });
    assertConsistentPolicy(policy);
    return repo.save(policy);
  }

  /**
   * Changes only the fields sent. Creates the row if a place somehow lacks one
   * (e.g. inserted by raw SQL). Run on the caller's transaction.
   */
  async update(
    manager: EntityManager,
    placeId: string,
    dto: BookingPolicyDto,
  ): Promise<BookingPolicy> {
    const repo = manager.getRepository(BookingPolicy);
    const current = await repo.findOneBy({ placeId });
    if (!current) return this.create(manager, placeId, dto);
    const merged = repo.merge(current, definedFields(dto));
    assertConsistentPolicy(merged);
    return repo.save(merged);
  }
}

// Mirrors the column defaults in booking-policy.entity.ts / docs/erd.md.
function policyDefaults(): Required<BookingPolicyDto> {
  return {
    checkinGraceMinutes: 15,
    lateCheckinAlertMinutes: 5,
    checkoutReminderMinutes: 15,
    overdueAlertMinutes: 15,
    minMinutes: 30,
    maxMinutes: 240,
    slotMinutes: 15,
    maxAdvanceDays: 7,
    maxActivePerUser: 1,
    maxExtensions: 2,
    modifyCutoffMinutes: 30,
  };
}

/** Drops undefined keys so they don't overwrite defaults or stored values. */
function definedFields(dto: BookingPolicyDto): Partial<BookingPolicy> {
  return Object.fromEntries(
    Object.entries(dto).filter(([, v]) => v !== undefined),
  ) as Partial<BookingPolicy>;
}

/** The two cross-field CHECKs on booking_policies, as a 400 instead of a 500. */
export function assertConsistentPolicy(p: BookingPolicyDto): void {
  if ((p.maxMinutes ?? 0) < (p.minMinutes ?? 0))
    throw new BadRequestException(
      'policy.maxMinutes must be >= policy.minMinutes',
    );
  if ((p.lateCheckinAlertMinutes ?? 0) > (p.checkinGraceMinutes ?? 0))
    throw new BadRequestException(
      'policy.lateCheckinAlertMinutes must be <= policy.checkinGraceMinutes',
    );
}
