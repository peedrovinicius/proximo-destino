import {
  Body,
  Controller,
  Get,
  ForbiddenException,
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
import { CompanyDataService } from '../tenancy/company-data.service'
import { CompanyRead, CompanyWrite } from '../tenancy/company-access.decorator'
import { CompanyClientsService } from '../tenancy/company-clients.service'
import { CreateClientDto, CreateCompanionDto } from './dto/create-client.dto'
import { UpdateCompanionDto } from './dto/update-companion.dto'
import { UpdateClientDto } from './dto/update-client.dto'
import { RemoveClientBonusDto } from './dto/bonus.dto'

@Controller('admin/clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...OPERATIONS_ROLES)
export class ClientsController {
  constructor(private readonly clients: ClientsService, private readonly scoped: CompanyDataService,
    private readonly scopedWrites: CompanyClientsService) {}

  @Get()
  @CompanyRead()
  list(@Req() request: AuthenticatedRequest, @Query('q') query?: string) {
    if (request.companyScope) return this.scoped.clients(request.user.id, request.user.sessionId, request.query.q as string | undefined)
    return this.clients.list(query)
  }

  @Get(':id')
  @CompanyRead()
  findOne(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    if (request.companyScope) return this.scoped.client(request.user.id, request.user.sessionId, id)
    return this.clients.findById(id)
  }

  @Get(':id/credits')
  credits(@Param('id') id: string) {
    return this.clients.credits(id)
  }

  @Post(':id/companions')
  @CompanyWrite()
  createCompanion(@Param('id') id: string, @Body() body: CreateCompanionDto, @Req() request: AuthenticatedRequest) {
    if (!request.companyScope) throw new ForbiddenException('Cadastro exige sessão de empresa')
    return this.scopedWrites.createCompanion(request.user.id, request.user.sessionId, id, body)
  }

  @Patch(':id/companions/:companionId')
  @CompanyWrite()
  updateCompanion(@Param('id') id: string, @Param('companionId') companionId: string,
    @Body() body: UpdateCompanionDto, @Req() request: AuthenticatedRequest) {
    if (!request.companyScope) throw new ForbiddenException('Cadastro exige sessão de empresa')
    return this.scopedWrites.updateCompanion(request.user.id, request.user.sessionId, id, companionId, body)
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
  @CompanyWrite()
  create(
    @Body() body: CreateClientDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.companyScope) return this.scopedWrites.create(request.user.id, request.user.sessionId, body)
    return this.clients.create(body, request.user.id)
  }

  @Patch(':id')
  @CompanyWrite()
  update(
    @Param('id') id: string,
    @Body() body: UpdateClientDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.companyScope) return this.scopedWrites.update(request.user.id, request.user.sessionId, id, body)
    return this.clients.update(id, body, request.user.id)
  }
}
