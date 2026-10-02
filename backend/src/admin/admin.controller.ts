import {
  Body,
  Controller,
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
import { AdminService } from './admin.service'
import {
  ApplyReservationBonusDto,
  CancelReservationDto,
  CreateReservationDto,
  UpdateReservationPassengersDto,
  UpdateReservationStatusDto,
} from './dto/reservation.dto'

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.FINANCE)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard()
  }

  @Get('search')
  search(@Query('q') query = '') {
    return this.admin.search(query)
  }

  @Get('reservations')
  reservations() {
    return this.admin.listReservations()
  }

  @Get('payments/orders')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  payments() {
    return this.admin.paymentsDashboard()
  }


  @Post('reservations')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  createReservation(@Body() body: CreateReservationDto) {
    return this.admin.createReservation(body)
  }

  @Get('reservations/:id/passengers')
  @Roles(UserRole.ADMIN)
  reservationPassengers(@Param('id') id: string) {
    return this.admin.reservationPassengers(id)
  }

  @Patch('reservations/:id/passengers')
  @Roles(UserRole.ADMIN)
  updateReservationPassengers(
    @Param('id') id: string,
    @Body() body: UpdateReservationPassengersDto,
  ) {
    return this.admin.updateReservationPassengers(id, body)
  }

  @Patch('reservations/:id/status')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.FINANCE)
  updateReservation(
    @Param('id') id: string,
    @Body() body: UpdateReservationStatusDto,
  ) {
    return this.admin.updateReservationStatus(id, body.status)
  }

  @Post('reservations/:id/cancel')
  @Roles(UserRole.ADMIN)
  cancelReservation(
    @Param('id') id: string,
    @Body() body: CancelReservationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.cancelReservation(
      id,
      body.creditAsBonus ?? false,
      body.reason,
      request.user.id,
    )
  }

  @Post('reservations/:id/bonus/apply')
  @Roles(UserRole.ADMIN)
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
}
