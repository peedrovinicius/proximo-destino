import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { DocumentsModule } from '../documents/documents.module'
import { PaymentsModule } from '../payments/payments.module'
import { ClientPortalGuard } from './client-portal.guard'
import { PortalController } from './portal.controller'
import { PortalService } from './portal.service'

@Module({
  imports: [JwtModule.register({}), DocumentsModule, PaymentsModule],
  controllers: [PortalController],
  providers: [PortalService, ClientPortalGuard],
})
export class PortalModule {}
