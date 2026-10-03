import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { CommercialService } from './commercial.service'
import {
  AddQuoteItemDto,
  CreateFinancePlanDto,
  CreateQuoteDto,
  UpdateInstallmentDto,
  UpdateReservationServiceDto,
} from './dto/quote.dto'

@Controller('admin/commercial')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.FINANCE)
export class AdminCommercialController {
  constructor(private readonly commercial: CommercialService) {}

  @Get('quotes')
  listQuotes(@Query('reservationId') reservationId?: string) {
    return this.commercial.listQuotes(reservationId)
  }

  @Post('quotes')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  createQuote(
    @Body() body: CreateQuoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.createQuote(body, request.user.id)
  }

  @Post('quotes/:id/items')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  addItem(
    @Param('id') id: string,
    @Body() body: AddQuoteItemDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.addQuoteItem(id, body, request.user.id)
  }

  @Delete('quotes/:quoteId/items/:itemId')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  removeItem(
    @Param('quoteId') quoteId: string,
    @Param('itemId') itemId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.removeQuoteItem(
      quoteId,
      itemId,
      request.user.id,
    )
  }

  @Post('quotes/:id/send')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  sendQuote(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.sendQuote(id, request.user.id)
  }

  @Post('quotes/:id/revise')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  reviseQuote(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.reviseQuote(id, request.user.id)
  }

  @Get('services')
  listServices(@Query('reservationId') reservationId?: string) {
    return this.commercial.listServices(reservationId)
  }

  @Patch('services/:id/status')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  updateServiceStatus(
    @Param('id') id: string,
    @Body() body: UpdateReservationServiceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.updateServiceStatus(
      id,
      body.status,
      request.user.id,
    )
  }

  @Get('finance/plans')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  listFinancePlans() {
    return this.commercial.listFinancePlans()
  }

  @Post('finance/plans')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  createFinancePlan(
    @Body() body: CreateFinancePlanDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.createFinancePlan(body, request.user.id)
  }

  @Patch('finance/installments/:id')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  updateInstallment(
    @Param('id') id: string,
    @Body() body: UpdateInstallmentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.updateInstallment(
      id,
      body.status,
      body.paymentMethod,
      request.user.id,
    )
  }
}
