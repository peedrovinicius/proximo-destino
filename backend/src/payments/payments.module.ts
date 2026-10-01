import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import {
  PaymentConnectionAdminController,
  PaymentOAuthController,
} from './payment-connection.controller'
import { PaymentConnectionService } from './payment-connection.service'

@Module({
  imports: [AuthModule],
  controllers: [PaymentConnectionAdminController, PaymentOAuthController],
  providers: [PaymentConnectionService],
  exports: [PaymentConnectionService],
})
export class PaymentsModule {}
