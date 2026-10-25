import { DonorResponseStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDonorResponseDto {
  @IsEnum(DonorResponseStatus)
  status!: DonorResponseStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
