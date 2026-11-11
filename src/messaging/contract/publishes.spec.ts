import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { AdminBookingsController } from '../../bookings/controllers/admin-bookings.controller';
import { AttendanceController } from '../../bookings/controllers/attendance.controller';
import { BookingsController } from '../../bookings/controllers/bookings.controller';
import {
  LibraryLinksClientController,
  LibraryMyLinkController,
} from '../../integrations/library/library-links.controller';
import { AdminLibraryPlacesController } from '../../integrations/library/library-places.controller';
import { PUBLISHES_KEY } from './publishes.decorator';
import { isPublishedType } from './schemas';

type Ctor = { prototype: object; name: string };
const WRITE = new Set([RequestMethod.POST, RequestMethod.PATCH, RequestMethod.PUT, RequestMethod.DELETE]);

/** Write routes in these controllers change state that partners hear about. */
const CONTROLLERS: Ctor[] = [
  BookingsController,
  AttendanceController,
  AdminBookingsController,
  AdminLibraryPlacesController,
  LibraryMyLinkController,
];

function writeRoutes(ctrl: Ctor): { name: string; publishes: unknown }[] {
  const proto = ctrl.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .filter((name) => WRITE.has(Reflect.getMetadata(METHOD_METADATA, proto[name] as object)))
    .map((name) => ({ name, publishes: Reflect.getMetadata(PUBLISHES_KEY, proto[name] as object) }));
}

describe('@Publishes on write endpoints', () => {
  it.each(CONTROLLERS.map((c) => [c.name, c] as const))(
    'every write route of %s declares contract messages it publishes',
    (_, ctrl) => {
      const routes = writeRoutes(ctrl);
      expect(routes.length).toBeGreaterThan(0);
      for (const r of routes) {
        expect({ route: r.name, publishes: Array.isArray(r.publishes) }).toEqual({ route: r.name, publishes: true });
        for (const type of r.publishes as string[]) expect(isPublishedType(type)).toBe(true);
      }
    },
  );

  it('LMS unlink publishes identity.unlinked', () => {
    const proto = LibraryLinksClientController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(PUBLISHES_KEY, proto.unlink)).toEqual(['identity.unlinked']);
  });
});
