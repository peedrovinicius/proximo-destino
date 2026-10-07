import { Module } from '@nestjs/common'
import { CompanyDataService } from './company-data.service'
import { CompanyScopeService } from './company-scope.service'
import { CompanyClientsService } from './company-clients.service'
import { CompanyTripsService } from './company-trips.service'
import { CompanyReservationsService } from './company-reservations.service'
import { CompanyReservationAccessService } from './company-reservation-access.service'
@Module({ providers: [CompanyScopeService, CompanyDataService, CompanyClientsService, CompanyTripsService, CompanyReservationsService, CompanyReservationAccessService], exports: [CompanyScopeService, CompanyDataService, CompanyClientsService, CompanyTripsService, CompanyReservationsService, CompanyReservationAccessService] })
export class TenancyModule {}
