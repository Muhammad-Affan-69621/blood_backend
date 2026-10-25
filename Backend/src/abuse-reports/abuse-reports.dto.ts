import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AbuseTargetType, AbuseReportStatus } from '@prisma/client';

export class CreateAbuseReportDto {
  @IsEnum(AbuseTargetType)
  targetType!: AbuseTargetType;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class ReviewAbuseReportDto {
  @IsEnum(AbuseReportStatus)
  status!: AbuseReportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolution?: string;
}
