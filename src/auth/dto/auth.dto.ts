import {
  IsEmail,
  IsNotEmpty,
  isNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @MinLength(8)
  password: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  roleId: number;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @MinLength(8)
  password: string;
}
