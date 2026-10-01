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
import { CreateTripDto, UpdateTripDto } from './dto/admin-trip.dto'
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

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  update(@Param('id') id: string, @Body() body: UpdateTripDto) {
    return this.trips.update(id, body)
  }
}
