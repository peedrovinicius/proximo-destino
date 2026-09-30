import { Type } from 'class-transformer'
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import {
  InstallmentStatus,
  QuoteItemCategory,
  ReservationServiceStatus,
} from '@prisma/client'

export class CreateQuoteDto {
  @IsString()
  @MaxLength(64)
  reservationId!: string

  @IsString()
  @MaxLength(180)
  title!: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validUntil?: Date

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  notes?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  discountCents?: number
}

export class AddQuoteItemDto {
  @IsEnum(QuoteItemCategory)
  category!: QuoteItemCategory

  @IsString()
  @MaxLength(300)
  description!: string

  @IsOptional()
  @IsString()
  @MaxLength(180)
  supplier?: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number

  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitCostCents!: number

  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitSaleCents!: number
}

export class CreateFinancePlanDto {
  @IsString()
  @MaxLength(64)
  reservationId!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  installmentCount!: number

  @Type(() => Date)
  @IsDate()
  firstDueDate!: Date

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  downPaymentCents?: number
}

export class UpdateInstallmentDto {
  @IsEnum(InstallmentStatus)
  status!: InstallmentStatus

  @IsOptional()
  @IsString()
  @MaxLength(80)
  paymentMethod?: string
}

export class UpdateReservationServiceDto {
  @IsEnum(ReservationServiceStatus)
  status!: ReservationServiceStatus
}
