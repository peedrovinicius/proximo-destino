import { Module } from '@nestjs/common'
import { CompanyDataService } from './company-data.service'
import { CompanyScopeService } from './company-scope.service'
import { CompanyClientsService } from './company-clients.service'
@Module({ providers: [CompanyScopeService, CompanyDataService, CompanyClientsService], exports: [CompanyScopeService, CompanyDataService, CompanyClientsService] })
export class TenancyModule {}
