import { Transform } from 'class-transformer'
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value
const normalizeEmail = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value

export class CreateCompanyAdminDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(160)
  displayName!: string

  @Transform(normalizeEmail) @IsEmail() @MaxLength(254)
  email!: string

  // Never trim or normalize passwords. The account remains inactive.
  @IsString() @MinLength(16) @MaxLength(128)
  password!: string
}

export class CreateCompanyDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(160)
  tradeName!: string

  @Transform(trim) @IsString() @MinLength(3) @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  legalName?: string

  @IsOptional() @Transform(trim) @IsString() @MaxLength(32)
  registrationNumber?: string

  @Transform(normalizeEmail) @IsEmail() @MaxLength(254)
  contactEmail!: string

  @IsOptional() @Transform(trim) @IsString() @MaxLength(32)
  contactPhone?: string

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  address?: string

  @Transform(trim) @IsString() @MinLength(2) @MaxLength(160)
  responsibleName!: string

  @Transform(normalizeEmail) @IsEmail() @MaxLength(254)
  responsibleEmail!: string
}
