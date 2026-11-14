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

  it('SeatPageResponseDto is { items: SeatResponseDto[], page, limit, total }', () => {
    const dto = doc.components!.schemas!.SeatPageResponseDto as unknown as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(dto.properties).sort()).toEqual([
      'items',
      'limit',
      'page',
      'total',
    ]);
    expect(dto.properties.items).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/SeatResponseDto' },
    });
  });

  it('list endpoints document their query parameters', () => {
    const readOp = (path: string, method: string) =>
      (doc.paths[path] as Record<string, any>)?.[method]; // any: OpenAPI operation shape is not needed here
    const queryNames = (op: { parameters?: Array<Record<string, unknown>> }) =>
      (op.parameters ?? [])
        .filter((p) => p.in === 'query')
        .map((p) => p.name as string)
        .sort();

    const listOp = readOp('/api/v1/seats', 'get');
    expect(queryNames(listOp)).toEqual([
      'areaId',
      'limit',
      'order',
      'page',
      'placeId',
      'search',
      'sortBy',
      'status',
    ]);
    const byPlaceOp = readOp('/api/v1/places/{placeId}/seats', 'get');
    expect(queryNames(byPlaceOp)).toEqual([
      'areaId',
      'limit',
      'order',
      'page',
      'search',
      'sortBy',
      'status',
    ]);

    const statusEnum = ['ACTIVE', 'MAINTENANCE', 'UNAVAILABLE'];
    for (const op of [listOp, byPlaceOp]) {
      // any: OpenAPI parameter shape is not needed here
      const status = (op.parameters as Array<Record<string, any>>).find(
        (p) => p.in === 'query' && p.name === 'status',
      );
      expect((status.schema as { enum: string[] }).enum).toEqual(statusEnum);
    }
  });

  it('request bodies are documented', () => {
    const bodySchema = (path: string, method: string) => {
      const op = (doc.paths[path] as Record<string, any>)?.[method]; // any: OpenAPI operation shape is not needed here
      return op.requestBody.content['application/json'].schema;
    };
    const dto = (name: string) =>
      doc.components!.schemas![name] as unknown as {
        properties: Record<string, unknown>;
        required?: string[];
      };

    expect(bodySchema('/api/v1/admin/places/{placeId}/seats', 'post')).toEqual({
      $ref: '#/components/schemas/CreateSeatDto',
    });
    expect(bodySchema('/api/v1/admin/seats/{seatId}', 'patch')).toEqual({
      $ref: '#/components/schemas/UpdateSeatDto',
    });
    expect(bodySchema('/api/v1/admin/seats/{seatId}/status', 'patch')).toEqual({
      $ref: '#/components/schemas/UpdateSeatStatusDto',
    });

    const create = dto('CreateSeatDto');
    expect(Object.keys(create.properties).sort()).toEqual([
      'areaId',
      'features',
      'label',
    ]);
    expect(create.required).toEqual(['label']);

    const update = dto('UpdateSeatDto');
    expect(Object.keys(update.properties).sort()).toEqual([
      'areaId',
      'features',
      'label',
    ]);
    expect(update.required).toBeUndefined();
    expect(update.properties.areaId).toMatchObject({
      type: 'string',
      format: 'uuid',
      nullable: true,
    });

    const updateStatus = dto('UpdateSeatStatusDto');
    expect((updateStatus.properties.status as { enum: string[] }).enum).toEqual(
      ['ACTIVE', 'MAINTENANCE', 'UNAVAILABLE'],
    );
    expect(updateStatus.required).toEqual(['status']);
  });

  it.each([
    ['get', '/api/v1/seats', ['200', '400']],
    ['get', '/api/v1/seats/{seatId}', ['200', '400', '404']],
    ['get', '/api/v1/places/{placeId}/seats', ['200', '400', '404']],
    [
      'post',
      '/api/v1/admin/places/{placeId}/seats',
      ['201', '400', '401', '403', '404', '409'],
    ],
    [
      'patch',
      '/api/v1/admin/seats/{seatId}',
      ['200', '400', '401', '403', '404', '409'],
    ],
    [
      'patch',
      '/api/v1/admin/seats/{seatId}/status',
      ['200', '400', '401', '403', '404'],
    ],
    [
      'delete',
      '/api/v1/admin/seats/{seatId}',
      ['204', '400', '401', '403', '404', '409'],
    ],
  ])('%s %s documents responses %j', (method, path, codes) => {
    const op = (doc.paths[path] as Record<string, any>)?.[method]; // any: OpenAPI operation shape is not needed here
    expect(Object.keys(op.responses).sort()).toEqual(codes);
  });
});
