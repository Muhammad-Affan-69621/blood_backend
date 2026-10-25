import { ConsentScope } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class GrantConsentDto {
  @ApiProperty({ enum: ConsentScope, enumName: 'ConsentScope' })
  @IsEnum(ConsentScope)
  scope!: ConsentScope;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
