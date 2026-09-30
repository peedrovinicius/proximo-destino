import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ClientPortalGuard } from './client-portal.guard'
import { PortalController } from './portal.controller'
import { PortalService } from './portal.service'

@Module({
  imports: [JwtModule.register({})],
  controllers: [PortalController],
  providers: [PortalService, ClientPortalGuard],
})
export class PortalModule {}
