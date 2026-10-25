import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BloodRequestStatus } from '@prisma/client';

export class UpdateBloodRequestStatusDto {
  @ApiProperty({
    enum: BloodRequestStatus,
    example: BloodRequestStatus.IN_PROGRESS,
    description: 'The new status for the blood request.',
  })
  @IsEnum(BloodRequestStatus)
  status!: BloodRequestStatus;

  @ApiPropertyOptional({
    example: 'The hospital has started coordinating donations.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
