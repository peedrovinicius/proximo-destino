import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { WhatsAppAutomationController } from './whatsapp-automation.controller'
import { WhatsAppAutomationService } from './whatsapp-automation.service'

@Module({
  imports: [AuthModule],
  controllers: [WhatsAppAutomationController],
  providers: [WhatsAppAutomationService],
  exports: [WhatsAppAutomationService],
})
export class NotificationsModule {}
