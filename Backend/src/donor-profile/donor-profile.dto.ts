import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BloodGroup } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDonorAvailabilityDto {
  @ApiProperty({ example: true, description: 'Whether the donor is currently available for donation' })
  @IsBoolean()
  isAvailable!: boolean;
}


export class SearchDonorsDto {
  @ApiPropertyOptional({ enum: BloodGroup, example: 'O_POSITIVE' })
  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup;

  @ApiPropertyOptional({ example: 'Quetta', maxLength: 120 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit = 20;
}
export class UpsertDonorProfileDto {
  @ApiProperty({ enum: BloodGroup, example: 'O_POSITIVE' })
  @IsEnum(BloodGroup)
  bloodGroup!: BloodGroup;

  @ApiProperty({ example: '2002-04-15', description: 'Date in YYYY-MM-DD format' })
  @IsDateString()
  dateOfBirth!: string;

  @ApiProperty({ example: 65.5, minimum: 1, maximum: 999.99 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(999.99)
  weightKg!: number;

  @ApiProperty({ example: 'Quetta', maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  city!: string;

  @ApiPropertyOptional({
    example: '2026-06-10',
    description: 'Use null if the donor has never donated or does not know the date',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  lastDonationDate?: string | null;

  @ApiPropertyOptional({ example: true, default: false })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}


