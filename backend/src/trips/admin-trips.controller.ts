import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
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
  ) {
    return this.trips.assignClientToSeat(id, seatNumber, body)
  }

  @Patch(':id/seats/:seatNumber')
  @Roles(UserRole.ADMIN)
  updateSeat(
    @Param('id') id: string,
    @Param('seatNumber', ParseIntPipe) seatNumber: number,
    @Body() body: UpdateSeatBlockDto,
  ) {
    return this.trips.setSeatBlocked(id, seatNumber, body.blocked)
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
  ) {
    return this.trips.bulkUpdateBoardingStatus(
      id,
      body.passengerIds,
      body.status,
    )
  }

  @Patch(':id/boarding/:passengerId')
  @Roles(UserRole.ADMIN)
  updateBoarding(
    @Param('id') id: string,
    @Param('passengerId') passengerId: string,
    @Body() body: UpdateBoardingStatusDto,
  ) {
    return this.trips.updateBoardingStatus(id, passengerId, body.status)
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  update(@Param('id') id: string, @Body() body: UpdateTripDto) {
    return this.trips.update(id, body)
  }
}
