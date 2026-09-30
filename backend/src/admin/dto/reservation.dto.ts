import { IsEnum, IsString, MaxLength } from 'class-validator'
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
