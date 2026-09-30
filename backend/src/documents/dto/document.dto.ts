import { Type } from 'class-transformer'
import {
  IsDate,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

export class IssueTravelVoucherDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  airline?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  flightNumber?: string

  @IsOptional()
  @IsString()
  @MaxLength(60)
  bookingCode?: string

  @IsOptional()
  @IsString()
  @MaxLength(60)
  seat?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  baggage?: string

  @IsOptional()
  @IsString()
  @MaxLength(160)
  departureLocation?: string

  @IsOptional()
  @IsString()
  @MaxLength(160)
  arrivalLocation?: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  departureAt?: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  arrivalAt?: Date

  @IsOptional()
  @IsString()
  @MaxLength(80)
  departureTerminal?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  arrivalTerminal?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string
}

export class IssuePurchaseReceiptDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string
}
