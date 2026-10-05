import { Module } from '@nestjs/common'
import { CompanyDataService } from './company-data.service'
import { CompanyScopeService } from './company-scope.service'
import { CompanyClientsService } from './company-clients.service'
import { CompanyTripsService } from './company-trips.service'
@Module({ providers: [CompanyScopeService, CompanyDataService, CompanyClientsService, CompanyTripsService], exports: [CompanyScopeService, CompanyDataService, CompanyClientsService, CompanyTripsService] })
export class TenancyModule {}
