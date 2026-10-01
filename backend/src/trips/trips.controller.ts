import { Controller, Get, Param, Query } from '@nestjs/common'
import { TripsService } from './trips.service'

@Controller('public/trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get()
  search(
    @Query('origin') origin?: string,
    @Query('destination') destination?: string,
    @Query('departureDate') departureDate?: string,
  ) {
    return this.tripsService.searchPublic(origin, destination, departureDate)
  }

  @Get(':id/seats')
  seatMap(@Param('id') id: string) {
    return this.tripsService.findPublicSeatMap(id)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tripsService.findPublicById(id)
  }
}
