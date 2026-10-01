import { Module } from '@nestjs/common'
import { TripsModule } from '../trips/trips.module'
import { AssistantController } from './assistant.controller'
import { AssistantService } from './assistant.service'

@Module({
  imports: [TripsModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
