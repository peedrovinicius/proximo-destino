import { Type } from 'class-transformer'
import {
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { TripStatus } from '@prisma/client'
import { BUS_TEMPLATES, SEAT_LAYOUTS } from '../bus-templates'

export class CreateTripDto {
  @IsString()
  @MaxLength(180)
  title!: string

  @IsString()
  @MaxLength(120)
  origin!: string

  @IsString()
  @MaxLength(120)
  destination!: string

  @Type(() => Date)
  @IsDate()
  departureDate!: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  returnDate?: Date

  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  capacity?: number | null

  @IsOptional()
  @IsIn([...BUS_TEMPLATES.map((template) => template.key), 'CUSTOM'])
  busTemplate?: string | null

  @IsOptional()
  @IsIn([...SEAT_LAYOUTS])
  seatLayout?: string | null

  @IsOptional()
  @IsIn([...BUS_TEMPLATES.map((template) => template.key), 'CUSTOM'])
  busTemplate?: string | null

  @IsOptional()
  @IsIn([...SEAT_LAYOUTS])
  seatLayout?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents?: number

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  imageUrl?: string
}

export class UpdateTripDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  origin?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  departureDate?: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  returnDate?: Date

  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  capacity?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents?: number

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  imageUrl?: string
}
