import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ClientPortalGuard, type ClientPortalRequest } from './client-portal.guard'
import { ClientPortalLoginDto, RequestReservationDto } from './dto/portal.dto'
import { PortalService } from './portal.service'

@Controller()
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Post('public/reservations/request')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestReservation(@Body() body: RequestReservationDto) {
    return this.portal.requestReservation(body)
  }

  @Post('client/login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() body: ClientPortalLoginDto) {
    return this.portal.login(body)
  }

  @Get('client/portal')
  @UseGuards(ClientPortalGuard)
  portalData(@Req() request: ClientPortalRequest) {
    return this.portal.getPortal(
      request.portal.clientId,
      request.portal.reservationId,
    )
  }
}
