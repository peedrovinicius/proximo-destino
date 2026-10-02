import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { DocumentsService } from '../documents/documents.service'
import { ClientPortalGuard, type ClientPortalRequest } from './client-portal.guard'
import {
  ClientPortalLoginDto,
  RequestCancellationDto,
  RequestReservationDto,
  UpdateClientPassengersDto,
  UpdateClientSeatsDto,
} from './dto/portal.dto'
import { PortalService } from './portal.service'

@Controller()
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('public/payments/config')
  paymentConfig() {
    return this.portal.paymentConfig()
  }

  @Post('public/reservations/request')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestReservation(@Body() body: RequestReservationDto) {
    return this.portal.requestReservation(body)
  }


  @Post('payments/mercado-pago/webhook')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  paymentWebhook(
    @Body() body: {
      type?: string
      action?: string
      data?: { id?: string }
    },
    @Headers('x-signature') xSignature?: string,
    @Headers('x-request-id') xRequestId?: string,
  ) {
    return this.portal.handlePaymentWebhook({
      type: body.type,
      action: body.action,
      dataId: body.data?.id,
      xSignature,
      xRequestId,
    })
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


  @Patch('client/passengers')
  @UseGuards(ClientPortalGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updatePassengers(
    @Req() request: ClientPortalRequest,
    @Body() body: UpdateClientPassengersDto,
  ) {
    return this.portal.updateClientPassengers(
      request.portal.clientId,
      request.portal.reservationId,
      body,
    )
  }

  @Patch('client/seats')
  @UseGuards(ClientPortalGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updateSeats(
    @Req() request: ClientPortalRequest,
    @Body() body: UpdateClientSeatsDto,
  ) {
    return this.portal.updateClientSeats(
      request.portal.clientId,
      request.portal.reservationId,
      body,
    )
  }

  @Post('client/cancellation-request')
  @UseGuards(ClientPortalGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestCancellation(
    @Req() request: ClientPortalRequest,
    @Body() body: RequestCancellationDto,
  ) {
    return this.portal.requestCancellation(
      request.portal.clientId,
      request.portal.reservationId,
      body.reason,
    )
  }

  @Post('client/payment/start')
  @UseGuards(ClientPortalGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  retryPayment(@Req() request: ClientPortalRequest) {
    return this.portal.retryPayment(
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
