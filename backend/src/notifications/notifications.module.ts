import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AdminNotificationsController } from './admin-notifications.controller'
import { AdminNotificationsService } from './admin-notifications.service'
import {
  EmailAutomationController,
  EmailOAuthController,
} from './email-automation.controller'
import { EmailAutomationService } from './email-automation.service'
import { WhatsAppAutomationController } from './whatsapp-automation.controller'
import { WhatsAppAutomationService } from './whatsapp-automation.service'

@Module({
  imports: [AuthModule],
  controllers: [
    AdminNotificationsController,
    EmailAutomationController,
    EmailOAuthController,
    WhatsAppAutomationController,
  ],
  providers: [
    AdminNotificationsService,
    EmailAutomationService,
    WhatsAppAutomationService,
  ],
  exports: [
    AdminNotificationsService,
    EmailAutomationService,
    WhatsAppAutomationService,
  ],
})
export class NotificationsModule {}
