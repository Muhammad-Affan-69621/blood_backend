import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BloodGroup, RequestUrgency } from '@prisma/client';

export class CreateBloodRequestDto {
  @IsEnum(BloodGroup)
  bloodGroup!: BloodGroup;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  unitsNeeded!: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  hospitalName!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  city!: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsEnum(RequestUrgency)
  urgency?: RequestUrgency;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  contactReference?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
