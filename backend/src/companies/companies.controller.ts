import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard'
import { CreatorGuard } from './creator.guard'
import { CompaniesService } from './companies.service'
import { CreateCompanyDto } from './company.dto'

@Controller('platform/companies')
@UseGuards(JwtAuthGuard, CreatorGuard)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

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
