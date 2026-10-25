import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum VerificationDecision {
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

export class SubmitVerificationDto {
  // Submission uses the saved donor profile; no custom review message is required.
  @ApiProperty({ required: false, description: 'Deprecated optional note; reviewers should assess the submitted profile details.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReviewVerificationDto {
  @ApiProperty({ enum: VerificationDecision })
  @IsEnum(VerificationDecision)
  status!: VerificationDecision;

  @ApiProperty({
    example: 'Donor details reviewed.',
    minLength: 3,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class VerificationQueueQueryDto {
  @ApiProperty({
    required: false,
    default: 20,
    minimum: 1,
    maximum: 100,
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiProperty({
    required: false,
    description: 'UUID of the last verification record from the previous page.',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
