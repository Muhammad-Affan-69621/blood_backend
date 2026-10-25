import { IsUrl } from 'class-validator';

export class RevokePushSubscriptionDto {
  @IsUrl({ require_protocol: true })
  endpoint!: string;
}