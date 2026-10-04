import { Module } from '@nestjs/common'
import { CompanyDataService } from './company-data.service'
import { CompanyScopeService } from './company-scope.service'
@Module({ providers: [CompanyScopeService, CompanyDataService], exports: [CompanyScopeService, CompanyDataService] })
export class TenancyModule {}
