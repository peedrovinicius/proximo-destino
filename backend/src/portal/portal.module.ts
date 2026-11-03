import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { DocumentsModule } from '../documents/documents.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { PaymentsModule } from '../payments/payments.module'
import { ClientPortalGuard } from './client-portal.guard'
import { PortalController } from './portal.controller'
import { PortalService } from './portal.service'
import { CompanyClientPortalService } from './company-client-portal.service'
import { CompanyClientPortalController } from './company-client-portal.controller'

@Module({
  imports: [JwtModule.register({}), DocumentsModule, PaymentsModule, NotificationsModule],
  controllers: [PortalController, CompanyClientPortalController],
  providers: [PortalService, ClientPortalGuard, CompanyClientPortalService],
})
export class PortalModule {}
