import {
  Body,
  Controller,
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
import { AdminService } from './admin.service'
import {
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
}
