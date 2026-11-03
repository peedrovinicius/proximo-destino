import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { TenancyModule } from '../tenancy/tenancy.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { PaymentsModule } from '../payments/payments.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
  imports: [AuthModule, PaymentsModule, NotificationsModule, TenancyModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
