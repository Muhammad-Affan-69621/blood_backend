import { IsEmail, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const INVITABLE_MEMBERSHIP_ROLES = ['MEMBER', 'VERIFIER', 'REQUEST_MANAGER'] as const;

export class InviteOrganizationMemberDto {
  @ApiProperty({ example: 'existing-user-uuid', required: false })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ example: 'person@example.com', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    enum: INVITABLE_MEMBERSHIP_ROLES,
    example: 'MEMBER',
  })
  @IsIn(INVITABLE_MEMBERSHIP_ROLES)
  role!: (typeof INVITABLE_MEMBERSHIP_ROLES)[number];
}

export class UpdateMembershipRoleDto {
  @ApiProperty({
    enum: ['MEMBER', 'VERIFIER', 'REQUEST_MANAGER', 'ORGANIZATION_ADMIN'],
    example: 'VERIFIER',
  })
  @IsIn(['MEMBER', 'VERIFIER', 'REQUEST_MANAGER', 'ORGANIZATION_ADMIN'])
  role!: 'MEMBER' | 'VERIFIER' | 'REQUEST_MANAGER' | 'ORGANIZATION_ADMIN';
}

export class UpdateMembershipStatusDto {
  @ApiProperty({
    enum: ['ACTIVE', 'SUSPENDED', 'REMOVED'],
    example: 'ACTIVE',
  })
  @IsIn(['ACTIVE', 'SUSPENDED', 'REMOVED'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
}
