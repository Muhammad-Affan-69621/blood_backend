import { SharingMode } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateContactPreferenceDto {
  @ApiProperty({ enum: SharingMode, enumName: 'SharingMode' })
  @IsEnum(SharingMode)
  sharingMode!: SharingMode;

  @ApiProperty({ example: 'v1', maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  consentVersion!: string;
}
