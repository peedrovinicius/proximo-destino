import { Type } from 'class-transformer'
import {
  IsEmail,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

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
