import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { UserRole } from '@prisma/client'
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import {
  AssignSeatClientDto,
  BulkUpdateBoardingStatusDto,
  CreateTripDto,
  UpdateBoardingStatusDto,
  UpdateSeatBlockDto,
  UpdateTripDto,
} from './dto/admin-trip.dto'
import { TripsService } from './trips.service'

@Controller('admin/trips')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.FINANCE)
export class AdminTripsController {
  constructor(private readonly trips: TripsService) {}

  @Get('bus-templates')
  busTemplates() {
    return this.trips.busTemplates()
  }

  @Get()
  list(@Query('q') query?: string) {
    return this.trips.listAdmin(query)
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  create(@Body() body: CreateTripDto) {
    return this.trips.create(body)
  }

  @Get(':id/seats')
  @Roles(UserRole.ADMIN)
  seatMap(@Param('id') id: string) {
    return this.trips.findAdminSeatMap(id)
  }

  @Post(':id/seats/:seatNumber/assignment')
  @Roles(UserRole.ADMIN)
  assignSeatClient(
    @Param('id') id: string,
    @Param('seatNumber', ParseIntPipe) seatNumber: number,
    @Body() body: AssignSeatClientDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.assignClientToSeat(id, seatNumber, body, request.user.id)
  }

  @Patch(':id/seats/:seatNumber')
  @Roles(UserRole.ADMIN)
  updateSeat(
    @Param('id') id: string,
    @Param('seatNumber', ParseIntPipe) seatNumber: number,
    @Body() body: UpdateSeatBlockDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.setSeatBlocked(
      id,
      seatNumber,
      body.blocked,
      request.user.id,
    )
  }

  @Get(':id/audit')
  @Roles(UserRole.ADMIN)
  audit(@Param('id') id: string) {
    return this.trips.operationalAudit(id)
  }

  @Get(':id/boarding')
  @Roles(UserRole.ADMIN)
  boardingList(@Param('id') id: string) {
    return this.trips.boardingList(id)
  }

  @Patch(':id/boarding')
  @Roles(UserRole.ADMIN)
  bulkUpdateBoarding(
    @Param('id') id: string,
    @Body() body: BulkUpdateBoardingStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.bulkUpdateBoardingStatus(
      id,
      body.passengerIds,
      body.status,
      request.user.id,
    )
  }

  @Patch(':id/boarding/:passengerId')
  @Roles(UserRole.ADMIN)
  updateBoarding(
    @Param('id') id: string,
    @Param('passengerId') passengerId: string,
    @Body() body: UpdateBoardingStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.updateBoardingStatus(
      id,
      passengerId,
      body.status,
      request.user.id,
    )
  }

  @Post(':id/complete')
  @Roles(UserRole.ADMIN)
  complete(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.completeTrip(id, request.user.id)
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  update(@Param('id') id: string, @Body() body: UpdateTripDto) {
    return this.trips.update(id, body)
  }
}
