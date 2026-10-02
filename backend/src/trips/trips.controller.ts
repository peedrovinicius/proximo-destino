import { Controller, Get, Header, Param, Query, StreamableFile } from '@nestjs/common'
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

  @Get(':id/image')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  async image(@Param('id') id: string) {
    const image = await this.tripsService.publicTripImage(id)
    return new StreamableFile(image.data, {
      type: image.mimeType,
      disposition: 'inline',
      length: image.data.length,
    })
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
