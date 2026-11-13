import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListUsersQueryDto, UpdateMyProfileDto } from './dto/user.dto';

const errors = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true }))
    .map((e) => e.property);

describe('users DTOs', () => {
  it('accepts a name and an https avatar, or null to clear the avatar', async () => {
    expect(await errors(UpdateMyProfileDto, { name: ' Jane ', avatarUrl: 'https://x.io/a.png' })).toEqual([]);
    expect(await errors(UpdateMyProfileDto, { avatarUrl: null })).toEqual([]);
    expect(await errors(UpdateMyProfileDto, {})).toEqual([]);
  });

  it('rejects null/blank names, http or non-URL avatars, and unknown fields', async () => {
    expect(await errors(UpdateMyProfileDto, { name: null })).toEqual(['name']);
    expect(await errors(UpdateMyProfileDto, { name: '   ' })).toEqual(['name']);
    expect(await errors(UpdateMyProfileDto, { name: 'a'.repeat(101) })).toEqual(['name']);
    expect(await errors(UpdateMyProfileDto, { name: 'a\u0007b' })).toEqual(['name']);
    expect(await errors(UpdateMyProfileDto, { avatarUrl: 'http://x.io/a.png' })).toEqual(['avatarUrl']);
    expect(await errors(UpdateMyProfileDto, { avatarUrl: 'not a url' })).toEqual(['avatarUrl']);
    expect(await errors(UpdateMyProfileDto, { role: 'ADMIN', email: 'x@y.z' })).toEqual(['role', 'email']);
  });

  it('parses list filters from query strings', async () => {
    const q = plainToInstance(ListUsersQueryDto, { isActive: 'false', page: '2' });
    expect(q.isActive).toBe(false);
    expect(q.page).toBe(2);
    expect(await errors(ListUsersQueryDto, { isActive: 'nope' })).toEqual(['isActive']);
    expect(await errors(ListUsersQueryDto, { role: 'ROOT' })).toEqual(['role']);
  });
});
