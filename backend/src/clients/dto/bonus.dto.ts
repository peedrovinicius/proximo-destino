import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class RemoveClientBonusDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents!: number

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string
}
