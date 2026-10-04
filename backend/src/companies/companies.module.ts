import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CompaniesController } from './companies.controller'
import { CompaniesService } from './companies.service'
import { CreatorGuard } from './creator.guard'

@Module({ imports: [AuthModule], controllers: [CompaniesController], providers: [CompaniesService, CreatorGuard] })
export class CompaniesModule {}
