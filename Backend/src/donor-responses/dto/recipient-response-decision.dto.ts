import { ApiProperty } from '@nestjs/swagger';
import { RecipientResponseDecision } from '@prisma/client';
import { IsIn } from 'class-validator';

export class RecipientResponseDecisionDto {
  @ApiProperty({
    enum: [RecipientResponseDecision.ACCEPTED, RecipientResponseDecision.REJECTED],
    example: RecipientResponseDecision.ACCEPTED,
    description: 'Accept or reject a willing donor response.',
  })
  @IsIn([RecipientResponseDecision.ACCEPTED, RecipientResponseDecision.REJECTED])
  decision!: RecipientResponseDecision;
}
