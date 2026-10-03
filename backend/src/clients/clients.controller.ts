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
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard'
import {
  ADMIN_ONLY_ROLES,
  OPERATIONS_ROLES,
} from '../auth/role-capabilities'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { ClientsService } from './clients.service'
import { CreateClientDto } from './dto/create-client.dto'
import { UpdateClientDto } from './dto/update-client.dto'
import { RemoveClientBonusDto } from './dto/bonus.dto'

@Controller('admin/clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...OPERATIONS_ROLES)
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

  @Get(':id/credits')
  credits(@Param('id') id: string) {
    return this.clients.credits(id)
  }

  @Post(':id/credits/remove')
  @Roles(...ADMIN_ONLY_ROLES)
  removeBonus(
    @Param('id') id: string,
    @Body() body: RemoveClientBonusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.clients.removeBonus(
      id,
      body.amountCents,
      body.reason,
      request.user.id,
    )
  }

  @Post()
  create(
    @Body() body: CreateClientDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.clients.create(body, request.user.id)
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateClientDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.clients.update(id, body, request.user.id)
  }
}
