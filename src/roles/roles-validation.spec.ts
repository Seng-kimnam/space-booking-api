import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleIdParamDto, RoleQueryDto } from './dto/role-query.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const errors = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('role DTO validation', () => {
  it('create: trims and uppercases the name', () => {
    expect(plainToInstance(CreateRoleDto, { name: '  manager ' }).name).toBe(
      'MANAGER',
    );
  });

  it.each([
    ['missing', {}],
    ['null', { name: null }],
    ['number', { name: 42 }],
    ['empty', { name: '' }],
    ['one char', { name: 'A' }],
    ['31 chars', { name: 'A'.repeat(31) }],
    ['leading digit', { name: '1ABC' }],
    ['space inside', { name: 'HAS SPACE' }],
    ['dash', { name: 'BAD-CHAR' }],
  ])('create: rejects a %s name', async (_, body) => {
    expect(await errors(CreateRoleDto, body)).toEqual(['name']);
  });

  it.each(['AB', 'MANAGER', 'STAFF_2', 'a'.repeat(30)])(
    'create: accepts %s',
    async (name) => {
      expect(await errors(CreateRoleDto, { name })).toEqual([]);
    },
  );

  it('update: missing name is allowed (no-op), null and invalid are not', async () => {
    expect(await errors(UpdateRoleDto, {})).toEqual([]);
    expect(await errors(UpdateRoleDto, { name: null })).toEqual(['name']);
    expect(await errors(UpdateRoleDto, { name: 'BAD-CHAR' })).toEqual(['name']);
    expect(await errors(UpdateRoleDto, { name: 'supervisor' })).toEqual([]);
  });

  it.each(['0', '-1', '1.5', 'abc', '2147483648'])(
    'id param: rejects %s',
    async (id) => {
      expect(await errors(RoleIdParamDto, { id })).toEqual(['id']);
    },
  );

  it('id param: accepts a positive int and converts it to a number', async () => {
    const dto = plainToInstance(RoleIdParamDto, { id: '7' });
    expect(dto.id).toBe(7);
    expect(await validate(dto)).toEqual([]);
  });

  it('query: search is uppercased; empty and too long are rejected', async () => {
    expect(plainToInstance(RoleQueryDto, { search: ' man ' }).search).toBe(
      'MAN',
    );
    expect(await errors(RoleQueryDto, { search: '' })).toEqual(['search']);
    expect(await errors(RoleQueryDto, { search: 'A'.repeat(31) })).toEqual([
      'search',
    ]);
  });
});

describe('RolesGuard', () => {
  const ctx = (user: unknown) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;
  const guard = (required: string[] | undefined) =>
    new RolesGuard({
      getAllAndOverride: () => required,
    } as unknown as Reflector);

  it('allows any caller when no @Roles is set', () => {
    expect(guard(undefined).canActivate(ctx(undefined))).toBe(true);
  });

  it('allows a caller with a required role', () => {
    expect(guard(['ADMIN']).canActivate(ctx({ role: 'ADMIN' }))).toBe(true);
  });

  it.each([
    ['wrong role', { role: 'USER' }],
    ['no role', {}],
    ['non-string role', { role: ['ADMIN'] }],
    ['no user', undefined],
  ])('rejects a caller with %s (403)', (_, user) => {
    expect(() => guard(['ADMIN']).canActivate(ctx(user))).toThrow(
      ForbiddenException,
    );
  });
});
