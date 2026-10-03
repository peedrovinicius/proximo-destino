import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AdminNotificationsController } from './admin-notifications.controller'
import { AdminNotificationsService } from './admin-notifications.service'
import { WhatsAppAutomationController } from './whatsapp-automation.controller'
import { WhatsAppAutomationService } from './whatsapp-automation.service'

@Module({
  imports: [AuthModule],
  controllers: [AdminNotificationsController, WhatsAppAutomationController],
  providers: [AdminNotificationsService, WhatsAppAutomationService],
  exports: [AdminNotificationsService, WhatsAppAutomationService],
})
export class NotificationsModule {}
