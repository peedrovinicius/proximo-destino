import { Controller, Get, Header, Param, Req } from '@nestjs/common'
import type { Request } from 'express'
import { CompanyPublicTripsService } from './company-public-trips.service'

@Controller('public/companies/:slug/trips')
export class CompanyPublicTripsController {
  constructor(private readonly trips: CompanyPublicTripsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  catalog(@Param('slug') slug: string, @Req() request: Request) { return this.trips.catalog(slug, request.query) }
  @Get(':id/seats')
  @Header('Cache-Control', 'no-store')
  seats(@Param('slug') slug: string, @Param('id') id: string) { return this.trips.seats(slug, id) }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@Param('slug') slug: string, @Param('id') id: string) { return this.trips.detail(slug, id) }
}
