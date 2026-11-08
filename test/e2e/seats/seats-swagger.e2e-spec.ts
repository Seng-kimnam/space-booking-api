import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { createTestApp } from '../../utils/create-test-app';

describe('seats Swagger contract', () => {
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
    ['/api/v1/seats', 'get', false],
    ['/api/v1/seats/{seatId}', 'get', false],
    ['/api/v1/places/{placeId}/seats', 'get', false],
    ['/api/v1/admin/places/{placeId}/seats', 'post', true],
    ['/api/v1/admin/seats/{seatId}', 'patch', true],
    ['/api/v1/admin/seats/{seatId}/status', 'patch', true],
    ['/api/v1/admin/seats/{seatId}', 'delete', true],
  ];

  it.each(ops)('%s %s exists, bearer security=%s', (path, method, secured) => {
    const op = (doc.paths[path] as Record<string, any>)?.[method]; // any: OpenAPI operation shape is not needed here
    expect(op).toBeDefined();
    expect(!!op.security?.some((s: object) => 'bearer' in s)).toBe(secured);
  });

  it('SeatResponseDto has exactly the 8 public fields', () => {
    const props = Object.keys(
      (doc.components!.schemas!.SeatResponseDto as { properties: object })
        .properties,
    ).sort();
    expect(props).toEqual(
      [
        'areaId',
        'createdAt',
        'features',
        'id',
        'label',
        'placeId',
        'status',
        'updatedAt',
      ].sort(),
    );
  });
});
