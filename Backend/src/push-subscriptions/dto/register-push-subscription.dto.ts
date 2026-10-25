import { Type } from 'class-transformer';
import {
  IsObject,
  IsString,
  IsUrl,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PushSubscriptionKeysDto {
  @IsString()
  @MinLength(16)
  p256dh!: string;

  @IsString()
  @MinLength(8)
  auth!: string;
}

export class RegisterPushSubscriptionDto {
  @IsUrl({ require_protocol: true })
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}