import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard'
import { CreatorGuard } from './creator.guard'
import { CompaniesService } from './companies.service'
import { CreateCompanyDto, CreateCompanyAdminDto } from './company.dto'
import { Throttle } from '@nestjs/throttler'

@Controller('platform/companies')
@UseGuards(JwtAuthGuard, CreatorGuard)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get(':id/admins')
  admins(@Param('id') id: string) { return this.companies.admins(id) }

  @Post(':id/admins')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  createAdmin(@Param('id') id: string, @Body() body: CreateCompanyAdminDto) {
    return this.companies.createPendingAdmin(id, body)
  }

  @Get()
  list() { return this.companies.list() }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateCompanyDto) {
    return this.companies.create(request.user.id, body)
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: CreateCompanyDto) {
    return this.companies.updateDraft(id, body)
  }
}
