import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto, RegisterDto, ResetPasswordDto } from './auth.dto';

const errorsOf = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

const register = {
  email: 'john@example.com',
  password: 'Password123!',
  name: 'John Doe',
  roleId: 2,
};

describe('auth DTO bounds', () => {
  it('accepts a normal registration', async () => {
    expect(await errorsOf(RegisterDto, register)).toEqual([]);
  });

  it('rejects a name over 100 characters, or empty', async () => {
    expect(await errorsOf(RegisterDto, { ...register, name: 'x'.repeat(101) })).toEqual([
      'name',
    ]);
    expect(await errorsOf(RegisterDto, { ...register, name: '' })).toEqual(['name']);
  });

  it('rejects a password over 72 bytes (bcrypt limit), counting bytes not characters', async () => {
    expect(await errorsOf(RegisterDto, { ...register, password: 'x'.repeat(72) })).toEqual([]);
    expect(await errorsOf(RegisterDto, { ...register, password: 'x'.repeat(73) })).toEqual([
      'password',
    ]);
    // 19 emoji = 19 characters but 76 bytes.
    expect(await errorsOf(RegisterDto, { ...register, password: '🔒'.repeat(19) })).toEqual([
      'password',
    ]);
  });

  it('applies the same limit to new passwords on change and reset', async () => {
    const long = 'x'.repeat(73);
    expect(
      await errorsOf(ChangePasswordDto, { currentPassword: 'Password123!', newPassword: long }),
    ).toEqual(['newPassword']);
    expect(
      await errorsOf(ResetPasswordDto, {
        email: 'john@example.com',
        otp: '123456',
        newPassword: long,
      }),
    ).toEqual(['newPassword']);
  });
});
