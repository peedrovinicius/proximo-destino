import { Type } from 'class-transformer'
import {
  IsDate,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  fullName?: string

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
}
