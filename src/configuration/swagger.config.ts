import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

export const SWAGGER_PATH = 'api/docs';

const PUBLIC_JSON_URL = `${SWAGGER_PATH}/public-json`;
const MANAGEMENT_JSON_URL = `${SWAGGER_PATH}/management-json`;

// Docs are exposed everywhere except production.
export const isSwaggerEnabled = (nodeEnv: string): boolean =>
  nodeEnv !== 'production';

/**
 * An operation is "management" when its route has an admin segment
 * (`/admin/...`, `/auth/admin/...`, `/auth/admin-only`). Classifying by route
 * keeps the split in one place instead of a decorator on every controller.
 */
const isManagementPath = (path: string): boolean =>
  path
    .split('/')
    .some((segment) => segment === 'admin' || segment.startsWith('admin-'));

function pickPaths(
  base: OpenAPIObject,
  meta: { title: string; description: string },
  keep: (path: string) => boolean,
): OpenAPIObject {
  const paths = Object.fromEntries(
    Object.entries(base.paths).filter(([path]) => keep(path)),
  );

  // Only list tags that this document actually uses, so no empty sections show.
  const usedTags = new Set(
    Object.values(paths).flatMap((item) =>
      Object.values(item).flatMap(
        (op: { tags?: string[] } | undefined) => op?.tags ?? [],
      ),
    ),
  );

  return {
    ...base,
    info: { ...base.info, title: meta.title, description: meta.description },
    paths,
    tags: (base.tags ?? []).filter((tag) => usedTags.has(tag.name)),
  };
}

export function setupSwagger(app: INestApplication): void {
  const base = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Space Booking API')
      .setDescription('Online Space Booking System API')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );

  const publicDoc = pickPaths(
    base,
    {
      title: 'Space Booking API: Public API',
      description:
        'Endpoints for users and integrating apps: auth, browsing places, areas and seats, bookings, check-in/out and Telegram.',
    },
    (path) => !isManagementPath(path),
  );
  const managementDoc = pickPaths(
    base,
    {
      title: 'Space Booking API: Management API',
      description:
        'Admin-only endpoints for managing places, areas, seats and bookings. Requires an ADMIN bearer token.',
    },
    isManagementPath,
  );

  // Raw JSON for each definition (no UI of their own).
  SwaggerModule.setup(`${SWAGGER_PATH}/public`, app, publicDoc, {
    ui: false,
    raw: ['json'],
    jsonDocumentUrl: PUBLIC_JSON_URL,
  });
  SwaggerModule.setup(`${SWAGGER_PATH}/management`, app, managementDoc, {
    ui: false,
    raw: ['json'],
    jsonDocumentUrl: MANAGEMENT_JSON_URL,
  });

  // One UI with a "Select a definition" dropdown to switch between the two.
  SwaggerModule.setup(SWAGGER_PATH, app, publicDoc, {
    explorer: true,
    customSiteTitle: 'Space Booking API',
    swaggerOptions: {
      persistAuthorization: true,
      urls: [
        { name: 'Public API', url: `/${PUBLIC_JSON_URL}` },
        { name: 'Management API', url: `/${MANAGEMENT_JSON_URL}` },
      ],
    },
  });
}
