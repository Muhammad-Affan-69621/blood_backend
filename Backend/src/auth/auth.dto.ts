import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'donor@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'TestPass123!', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({
    example: 'DONOR',
    enum: ['DONOR', 'RECIPIENT'],
    default: 'DONOR',
  })
  @IsOptional()
  @IsEnum(['DONOR', 'RECIPIENT'])
  role?: 'DONOR' | 'RECIPIENT';
}

export class LoginDto {
  @ApiProperty({ example: 'donor@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'TestPass123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token returned by registration or login.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  refreshToken!: string;
}

// Password recovery request DTOs
export class ForgotPasswordDto {
  @ApiProperty({ example: 'donor@example.com' })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Single-use password-reset token received by email.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @ApiProperty({ example: 'NewSecurePass123!', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
