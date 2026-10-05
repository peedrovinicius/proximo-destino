import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard'
import {
  ADMIN_ONLY_ROLES,
  FINANCE_ROLES,
  OPERATIONS_ROLES,
  STAFF_ROLES,
} from '../auth/role-capabilities'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { AdminService } from './admin.service'
import { CompanyDataService } from '../tenancy/company-data.service'
import { CompanyRead, CompanyWrite } from '../tenancy/company-access.decorator'
import { CompanyReservationsService } from '../tenancy/company-reservations.service'
import {
  ApplyReservationBonusDto,
  CancelReservationDto,
  CreateReservationDto,
  RefundReservationPaymentDto,
  RegisterManualPaymentDto,
  ResolveCancellationRequestDto,
  ReverseManualPaymentDto,
  UpdateReservationPassengersDto,
  UpdateReservationStatusDto,
} from './dto/reservation.dto'

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly scoped: CompanyDataService,
    private readonly scopedReservations: CompanyReservationsService) {}

  @Get('dashboard')
  @CompanyRead()
  dashboard(@Req() request: AuthenticatedRequest) {
    if (request.companyScope) return this.scoped.dashboard(request.user.id, request.user.sessionId)
    return this.admin.dashboard(request.user.role)
  }

  @Get('search')
  @CompanyRead()
  search(
    @Query('q') query = '',
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.companyScope) return this.scoped.search(request.user.id, request.user.sessionId, (request.query.q ?? '') as string)
    return this.admin.search(query, request.user.role)
  }

  @Get('audit')
  @Roles(...ADMIN_ONLY_ROLES)
  audit(
    @Query('category') category = 'ALL',
    @Query('role') role = 'ALL',
    @Query('q') query = '',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.auditTrail(category, role, query, from, to)
  }

  @Get('reservations')
  @CompanyRead()
  reservations(@Req() request: AuthenticatedRequest) {
    if (request.companyScope) return this.scoped.reservations(request.user.id, request.user.sessionId)
    return this.admin.listReservations(request.user.role)
  }

  @Get('payments/orders')
  @Header('Cache-Control', 'no-store')
  @CompanyRead()
  @Roles(...FINANCE_ROLES)
  payments(@Req() request: AuthenticatedRequest) {
    if (request.companyScope) return this.scoped.onlinePaymentsSummary(request.user.id, request.user.sessionId)
    return this.admin.paymentsDashboard()
  }


  @Post('reservations')
  @CompanyWrite()
  @Roles(...OPERATIONS_ROLES)
  createReservation(
    @Body() body: CreateReservationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.companyScope) return this.scopedReservations.create(request.user.id, request.user.sessionId, body)
    return this.admin.createReservation(body, request.user.id)
  }

  @Get('reservations/:id/passengers')
  @CompanyRead()
  @Roles(...ADMIN_ONLY_ROLES)
  reservationPassengers(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    if (request.companyScope) return this.scopedReservations.passengers(request.user.id, request.user.sessionId, id)
    return this.admin.reservationPassengers(id)
  }

  @Patch('reservations/:id/passengers')
  @CompanyWrite()
  @Roles(...ADMIN_ONLY_ROLES)
  updateReservationPassengers(
    @Param('id') id: string,
    @Body() body: UpdateReservationPassengersDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.companyScope) return this.scopedReservations.updatePassengers(request.user.id, request.user.sessionId, id, body)
    return this.admin.updateReservationPassengers(
      id,
      body,
      request.user.id,
    )
  }

  @Patch('reservations/:id/status')
  @Roles(...OPERATIONS_ROLES)
  updateReservation(
    @Param('id') id: string,
    @Body() body: UpdateReservationStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.updateReservationStatus(
      id,
      body.status,
      request.user.id,
    )
  }

  @Post('reservations/:id/cancel')
  @CompanyWrite()
  @Roles(...ADMIN_ONLY_ROLES)
  cancelReservation(
    @Param('id') id: string,
    @Body() body: CancelReservationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.companyScope) return this.scopedReservations.cancelDraft(request.user.id, request.user.sessionId, id, body)
    return this.admin.cancelReservation(
      id,
      body.creditAsBonus ?? false,
      body.reason,
      request.user.id,
    )
  }

  @Post('reservations/:id/cancel-request/reject')
  @Roles(...ADMIN_ONLY_ROLES)
  rejectCancellationRequest(
    @Param('id') id: string,
    @Body() body: ResolveCancellationRequestDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.rejectCancellationRequest(
      id,
      body.note,
      request.user.id,
    )
  }

  @Post('reservations/:id/bonus/apply')
  @Roles(...ADMIN_ONLY_ROLES)
  applyBonus(
    @Param('id') id: string,
    @Body() body: ApplyReservationBonusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.applyBonus(
      id,
      body.amountCents,
      body.note,
      request.user.id,
    )
  }

  @Get('reservations/:id/finance')
  @Roles(...FINANCE_ROLES)
  reservationFinance(@Param('id') id: string) {
    return this.admin.reservationFinance(id)
  }

  @Post('reservations/:id/finance/reconcile')
  @Roles(...FINANCE_ROLES)
  reconcileReservationPayment(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.reconcileReservationPayment(
      id,
      request.user.id,
    )
  }

  @Post('reservations/:id/finance/manual-payments')
  @Roles(...FINANCE_ROLES)
  registerManualPayment(
    @Param('id') id: string,
    @Body() body: RegisterManualPaymentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.registerManualPayment(
      id,
      body,
      request.user.id,
    )
  }

  @Post('reservations/:id/finance/manual-payments/:paymentId/reverse')
  @Roles(...FINANCE_ROLES)
  reverseManualPayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() body: ReverseManualPaymentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.reverseManualPayment(
      id,
      paymentId,
      body.reason,
      request.user.id,
    )
  }

  @Post('reservations/:id/finance/refund')
  @Roles(...FINANCE_ROLES)
  refundReservationPayment(
    @Param('id') id: string,
    @Body() body: RefundReservationPaymentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.refundReservationPayment(
      id,
      body.amountCents,
      body.reason,
      request.user.id,
    )
  }
}
