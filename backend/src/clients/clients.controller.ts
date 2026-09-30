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
import { ClientsService } from './clients.service'
import { CreateClientDto } from './dto/create-client.dto'
import { UpdateClientDto } from './dto/update-client.dto'

@Controller('admin/clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.AGENT)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@Query('q') query?: string) {
    return this.clients.list(query)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clients.findById(id)
  }

  @Post()
  create(@Body() body: CreateClientDto) {
    return this.clients.create(body)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateClientDto) {
    return this.clients.update(id, body)
  }
}
