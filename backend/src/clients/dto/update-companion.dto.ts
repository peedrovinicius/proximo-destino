import { Type } from 'class-transformer'
import { IsDate, IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateCompanionDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  fullName?: string

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
