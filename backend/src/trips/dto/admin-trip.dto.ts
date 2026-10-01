import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { BoardingStatus, TripStatus } from '@prisma/client'
import {
  BUS_TEMPLATES,
  SEAT_LAYOUTS,
  VEHICLE_FEATURE_POSITIONS,
  VEHICLE_FEATURE_SIDES,
  VEHICLE_FEATURE_TYPES,
} from '../bus-templates'

const busTemplateKeys = [...BUS_TEMPLATES.map((template) => template.key), 'CUSTOM']

export class VehicleFeatureDto {
  @IsIn([...VEHICLE_FEATURE_TYPES])
  type!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  deck!: number

  @IsIn([...VEHICLE_FEATURE_POSITIONS])
  position!: string

  @IsIn([...VEHICLE_FEATURE_SIDES])
  side!: string
}

class TripVehicleFieldsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  capacity?: number | null

  @IsOptional()
  @IsIn(busTemplateKeys)
  busTemplate?: string | null

  @IsOptional()
  @IsIn([...SEAT_LAYOUTS])
  seatLayout?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  deckCount?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(79)
  lowerDeckCapacity?: number | null

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VehicleFeatureDto)
  vehicleFeatures?: VehicleFeatureDto[] | null

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(80, { each: true })
  blockedSeats?: number[]
}

export class CreateTripDto extends TripVehicleFieldsDto {
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

export class UpdateTripDto extends TripVehicleFieldsDto {
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


export class UpdateSeatBlockDto {
  @IsBoolean()
  blocked!: boolean
}


export class UpdateBoardingStatusDto {
  @IsEnum(BoardingStatus)
  status!: BoardingStatus
}


export class BulkUpdateBoardingStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  passengerIds!: string[]

  @IsEnum(BoardingStatus)
  status!: BoardingStatus
}


export class AssignSeatClientDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string

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
  @IsString()
  @MaxLength(32)
  document?: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  birthDate?: Date
}
