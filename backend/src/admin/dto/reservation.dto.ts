import { Type } from 'class-transformer'
import {
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsBoolean,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { ReservationStatus } from '@prisma/client'

export class CreateReservationDto {
  @IsString()
  @MaxLength(64)
  clientId!: string

  @IsString()
  @MaxLength(64)
  tripId!: string
}

export class UpdateReservationStatusDto {
  @IsEnum(ReservationStatus)
  status!: ReservationStatus
}

export class ReservationPassengerInputDto {
  @IsString()
  @MaxLength(64)
  id!: string

  @IsOptional()
  @IsString()
  @MaxLength(180)
  fullName?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(40)
  document?: string | null

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  birthDate?: Date | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(80)
  seatNumber?: number | null
}

export class UpdateReservationPassengersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReservationPassengerInputDto)
  passengers!: ReservationPassengerInputDto[]
}


export class CancelReservationDto {
  @IsOptional()
  @IsBoolean()
  creditAsBonus?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string
}

export class ApplyReservationBonusDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents!: number

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string
}
