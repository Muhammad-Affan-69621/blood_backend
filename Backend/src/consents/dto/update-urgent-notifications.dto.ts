import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateUrgentNotificationsDto {
  @ApiProperty({
    description: 'Whether the donor opts in to urgent blood-request notifications',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;
}
