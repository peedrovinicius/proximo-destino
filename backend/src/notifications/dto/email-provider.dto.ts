import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

export class ConnectEmailProviderDto {
  @IsString()
  @MinLength(16)
  @MaxLength(220)
  apiKey!: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fromName?: string

  @IsEmail()
  @MaxLength(160)
  fromEmail!: string

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  replyToEmail?: string

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  adminCopyEmail?: string
}

export class UpdateEmailProviderSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fromName?: string

  @IsEmail()
  @MaxLength(160)
  fromEmail!: string

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  replyToEmail?: string

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  adminCopyEmail?: string
}

export class UpdateEmailAutomationDto {
  @IsBoolean()
  enabled!: boolean
}
