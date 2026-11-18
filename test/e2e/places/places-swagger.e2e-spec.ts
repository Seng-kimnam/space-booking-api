import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { createTestApp } from '../../utils/create-test-app';

describe('places Swagger contract', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    app = await createTestApp();
    doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
  });
  afterAll(() => app.close());

  const ops: Array<[string, string, boolean]> = [
    ['/api/v1/places', 'get', false],
    ['/api/v1/places/{placeId}', 'get', false],
    ['/api/v1/admin/places', 'post', true],
    ['/api/v1/admin/places/{placeId}', 'patch', true],
    ['/api/v1/admin/places/{placeId}', 'delete', true],
  ];

  it.each(ops)('%s %s exists, bearer security=%s', (path, method, secured) => {
    const op = (doc.paths[path] as Record<string, any>)?.[method]; // any: OpenAPI operation shape is not needed here
    expect(op).toBeDefined();
    expect(!!op.security?.some((s: object) => 'bearer' in s)).toBe(secured);
  });

  it('PlaceResponseDto has exactly the 11 public fields', () => {
    const props = Object.keys(
      (doc.components!.schemas!.PlaceResponseDto as { properties: object })
        .properties,
    ).sort();
    expect(props).toEqual(
      [
        'address',
        'createdAt',
        'description',
        'id',
        'isActive',
        'lat',
        'lng',
        'name',
        'timezone',
        'type',
        'updatedAt',
      ].sort(),
    );
  });
});
