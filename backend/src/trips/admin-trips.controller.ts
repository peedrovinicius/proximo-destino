import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard'
import {
  ADMIN_ONLY_ROLES,
  OPERATIONS_ROLES,
  STAFF_ROLES,
} from '../auth/role-capabilities'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import {
  AssignSeatClientDto,
  BulkUpdateBoardingStatusDto,
  CreateTripDto,
  MoveSeatAssignmentDto,
  ScanBoardingQrDto,
  UpdateBoardingStatusDto,
  UpdateSeatBlockDto,
  UpdateTripDto,
} from './dto/admin-trip.dto'
import { TripsService } from './trips.service'
import { CompanyDataService } from '../tenancy/company-data.service'
import { CompanyRead } from '../tenancy/company-access.decorator'

@Controller('admin/trips')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class AdminTripsController {
  constructor(private readonly trips: TripsService, private readonly scoped: CompanyDataService) {}

  @Get('bus-templates')
  @Roles(...OPERATIONS_ROLES)
  busTemplates() {
    return this.trips.busTemplates()
  }

  @Get()
  @CompanyRead()
  @Roles(...OPERATIONS_ROLES)
  list(@Req() request: AuthenticatedRequest, @Query('q') query?: string) {
    if (request.companyScope) return this.scoped.trips(request.user.id, request.user.sessionId)
    return this.trips.listAdmin(query)
  }

  @Get('image-suggestions')
  @Roles(...OPERATIONS_ROLES)
  imageSuggestions(@Query('q') query?: string) {
    return this.trips.imageSuggestions(query)
  }

  @Post()
  @Roles(...OPERATIONS_ROLES)
  create(
    @Body() body: CreateTripDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.create(body, request.user.id)
  }

  @Post(':id/image')
  @Roles(...OPERATIONS_ROLES)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2_500_000 },
    }),
  )
  uploadImage(
    @Param('id') id: string,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.uploadTripImage(id, file, request.user.id)
  }

  @Delete(':id/image')
  @Roles(...OPERATIONS_ROLES)
  clearImage(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.clearTripImage(id, request.user.id)
  }

  @Get(':id/seats')
  @Roles(...ADMIN_ONLY_ROLES)
  seatMap(@Param('id') id: string) {
    return this.trips.findAdminSeatMap(id)
  }

  @Post(':id/seats/:seatNumber/assignment')
  @Roles(...ADMIN_ONLY_ROLES)
  assignSeatClient(
    @Param('id') id: string,
    @Param('seatNumber', ParseIntPipe) seatNumber: number,
    @Body() body: AssignSeatClientDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.assignClientToSeat(id, seatNumber, body, request.user.id)
  }

  @Patch(':id/seats/:seatNumber/assignment')
  @Roles(...ADMIN_ONLY_ROLES)
  moveSeatAssignment(
    @Param('id') id: string,
    @Param('seatNumber', ParseIntPipe) seatNumber: number,
    @Body() body: MoveSeatAssignmentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.moveSeatAssignment(
      id,
      seatNumber,
      body.toSeatNumber,
      request.user.id,
    )
  }

  @Patch(':id/seats/:seatNumber')
  @Roles(...ADMIN_ONLY_ROLES)
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
  @Roles(...ADMIN_ONLY_ROLES)
  audit(@Param('id') id: string) {
    return this.trips.operationalAudit(id)
  }

  @Get(':id/boarding')
  @Roles(...ADMIN_ONLY_ROLES)
  boardingList(@Param('id') id: string) {
    return this.trips.boardingList(id)
  }

  @Post(':id/boarding/scan')
  @Roles(...ADMIN_ONLY_ROLES)
  scanBoardingQr(
    @Param('id') id: string,
    @Body() body: ScanBoardingQrDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.scanBoardingQr(
      id,
      body.code,
      request.user.id,
    )
  }

  @Patch(':id/boarding')
  @Roles(...ADMIN_ONLY_ROLES)
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
  @Roles(...ADMIN_ONLY_ROLES)
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
  @Roles(...ADMIN_ONLY_ROLES)
  complete(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.completeTrip(id, request.user.id)
  }

  @Patch(':id')
  @Roles(...OPERATIONS_ROLES)
  update(
    @Param('id') id: string,
    @Body() body: UpdateTripDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trips.update(id, body, request.user.id)
  }
}
