import { IsString, MaxLength, MinLength } from 'class-validator'
export class PasswordChangeDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string
  @IsString() @MinLength(16) @MaxLength(128) newPassword!: string
}
