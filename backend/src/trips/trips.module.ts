import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { TenancyModule } from '../tenancy/tenancy.module'
import { AdminTripsController } from './admin-trips.controller'
import { TripsController } from './trips.controller'
import { TripsService } from './trips.service'
import { CompanyPublicTripsService } from './company-public-trips.service'
import { CompanyPublicTripsController } from './company-public-trips.controller'

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [TripsController, AdminTripsController, CompanyPublicTripsController],
  providers: [TripsService, CompanyPublicTripsService],
  exports: [TripsService],
})
export class TripsModule {}
