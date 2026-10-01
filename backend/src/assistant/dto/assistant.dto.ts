import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class AssistantHistoryItemDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant'

  @IsString()
  @MinLength(1)
  @MaxLength(800)
  content!: string
}

export class AskAssistantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(800)
  message!: string

  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => AssistantHistoryItemDto)
  history: AssistantHistoryItemDto[] = []
}
