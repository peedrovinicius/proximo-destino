import { Type } from 'class-transformer'
import {
  IsDate,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'

export class CreateCompanionDto {
  @IsString()
  @MaxLength(160)
  fullName!: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  document?: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  birthDate?: Date

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relationship?: string
}

export class CreateClientDto {
  @IsString()
  @MaxLength(160)
  fullName!: string

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  birthDate?: Date

  @IsOptional()
  @IsString()
  @MaxLength(32)
  document?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateCompanionDto)
  companions?: CreateCompanionDto[]
}
