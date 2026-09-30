import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AdminCommercialController } from './commercial.controller'
import { CommercialService } from './commercial.service'

@Module({
  imports: [AuthModule],
  controllers: [AdminCommercialController],
  providers: [CommercialService],
  exports: [CommercialService],
})
export class CommercialModule {}
