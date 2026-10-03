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
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard'
import {
  FINANCE_ROLES,
  OPERATIONS_ROLES,
  STAFF_ROLES,
} from '../auth/role-capabilities'
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
@Roles(...STAFF_ROLES)
export class AdminCommercialController {
  constructor(private readonly commercial: CommercialService) {}

  @Get('quotes')
  listQuotes(@Query('reservationId') reservationId?: string) {
    return this.commercial.listQuotes(reservationId)
  }

  @Post('quotes')
  @Roles(...OPERATIONS_ROLES)
  createQuote(
    @Body() body: CreateQuoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.createQuote(body, request.user.id)
  }

  @Post('quotes/:id/items')
  @Roles(...OPERATIONS_ROLES)
  addItem(
    @Param('id') id: string,
    @Body() body: AddQuoteItemDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.addQuoteItem(id, body, request.user.id)
  }

  @Delete('quotes/:quoteId/items/:itemId')
  @Roles(...OPERATIONS_ROLES)
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
  @Roles(...OPERATIONS_ROLES)
  sendQuote(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.sendQuote(id, request.user.id)
  }

  @Post('quotes/:id/revise')
  @Roles(...OPERATIONS_ROLES)
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
  @Roles(...OPERATIONS_ROLES)
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
  @Roles(...FINANCE_ROLES)
  listFinancePlans() {
    return this.commercial.listFinancePlans()
  }

  @Post('finance/plans')
  @Roles(...FINANCE_ROLES)
  createFinancePlan(
    @Body() body: CreateFinancePlanDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commercial.createFinancePlan(body, request.user.id)
  }

  @Patch('finance/installments/:id')
  @Roles(...FINANCE_ROLES)
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
