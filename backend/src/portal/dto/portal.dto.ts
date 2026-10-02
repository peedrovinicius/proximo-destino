import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDate,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class ReservationPassengerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  document?: string
}

export class RequestReservationDto {
  @IsString()
  @MaxLength(64)
  tripId!: string

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string

  @IsEmail()
  @MaxLength(254)
  email!: string

  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phone!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  passengerCount!: number

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(80, { each: true })
  selectedSeats?: number[]

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ReservationPassengerDto)
  passengers?: ReservationPassengerDto[]

  @IsOptional()
  @IsIn(['RESERVATION', 'PURCHASE'])
  intent?: 'RESERVATION' | 'PURCHASE'

  @IsOptional()
  @IsIn(['PIX', 'CARD', 'BOLETO', 'TRANSFER'])
  paymentMethod?: 'PIX' | 'CARD' | 'BOLETO' | 'TRANSFER'
}

export class ClientPortalLoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  code!: string
}


export class ClientPassengerUpdateDto {
  @IsString()
  @MaxLength(64)
  id!: string

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  document?: string | null

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  birthDate?: Date | null
}

export class UpdateClientPassengersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ClientPassengerUpdateDto)
  passengers!: ClientPassengerUpdateDto[]
}

export class UpdateClientSeatsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(80, { each: true })
  selectedSeats!: number[]
}

export class RequestCancellationDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string
}
