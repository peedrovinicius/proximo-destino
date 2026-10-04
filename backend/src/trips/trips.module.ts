import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { TenancyModule } from '../tenancy/tenancy.module'
import { AdminTripsController } from './admin-trips.controller'
import { TripsController } from './trips.controller'
import { TripsService } from './trips.service'

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [TripsController, AdminTripsController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
