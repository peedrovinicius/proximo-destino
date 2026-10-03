import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { AdminCommercialController } from './commercial.controller'
import { CommercialService } from './commercial.service'

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [AdminCommercialController],
  providers: [CommercialService],
  exports: [CommercialService],
})
export class CommercialModule {}
