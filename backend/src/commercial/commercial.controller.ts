import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
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
  createQuote(@Body() body: CreateQuoteDto) {
    return this.commercial.createQuote(body)
  }

  @Post('quotes/:id/items')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  addItem(@Param('id') id: string, @Body() body: AddQuoteItemDto) {
    return this.commercial.addQuoteItem(id, body)
  }

  @Delete('quotes/:quoteId/items/:itemId')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  removeItem(
    @Param('quoteId') quoteId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.commercial.removeQuoteItem(quoteId, itemId)
  }

  @Post('quotes/:id/send')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  sendQuote(@Param('id') id: string) {
    return this.commercial.sendQuote(id)
  }

  @Post('quotes/:id/revise')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  reviseQuote(@Param('id') id: string) {
    return this.commercial.reviseQuote(id)
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
  ) {
    return this.commercial.updateServiceStatus(id, body.status)
  }

  @Get('finance/plans')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  listFinancePlans() {
    return this.commercial.listFinancePlans()
  }

  @Post('finance/plans')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  createFinancePlan(@Body() body: CreateFinancePlanDto) {
    return this.commercial.createFinancePlan(body)
  }

  @Patch('finance/installments/:id')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  updateInstallment(
    @Param('id') id: string,
    @Body() body: UpdateInstallmentDto,
  ) {
    return this.commercial.updateInstallment(
      id,
      body.status,
      body.paymentMethod,
    )
  }
}
