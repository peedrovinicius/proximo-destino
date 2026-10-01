import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AssistantService } from './assistant.service'
import { AskAssistantDto } from './dto/assistant.dto'

@Controller('public/assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  ask(@Body() body: AskAssistantDto) {
    return this.assistant.ask(body)
  }
}
