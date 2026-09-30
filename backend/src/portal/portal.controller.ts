import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  Param,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { DocumentsService } from '../documents/documents.service'
import { ClientPortalGuard, type ClientPortalRequest } from './client-portal.guard'
import { ClientPortalLoginDto, RequestReservationDto } from './dto/portal.dto'
import { PortalService } from './portal.service'

@Controller()
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly documents: DocumentsService,
  ) {}

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

  @Post('client/quotes/:id/approve')
  @UseGuards(ClientPortalGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  approveQuote(
    @Param('id') id: string,
    @Req() request: ClientPortalRequest,
  ) {
    return this.portal.approveQuote(
      request.portal.clientId,
      request.portal.reservationId,
      id,
    )
  }

  @Post('client/quotes/:id/reject')
  @UseGuards(ClientPortalGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  rejectQuote(
    @Param('id') id: string,
    @Req() request: ClientPortalRequest,
  ) {
    return this.portal.rejectQuote(
      request.portal.clientId,
      request.portal.reservationId,
      id,
    )
  }

  @Get('client/documents/:id/pdf')
  @UseGuards(ClientPortalGuard)
  async documentPdf(
    @Param('id') id: string,
    @Req() request: ClientPortalRequest,
    @Res() response: Response,
  ) {
    const result = await this.documents.renderClientPdf(
      id,
      request.portal.reservationId,
      request.portal.clientId,
    )
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${result.filename}"`,
    )
    response.setHeader('Cache-Control', 'private, no-store')
    response.send(result.buffer)
  }
}
