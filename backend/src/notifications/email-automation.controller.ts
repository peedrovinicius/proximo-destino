import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard'
import { ADMIN_ONLY_ROLES } from '../auth/role-capabilities'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import {
  ConnectEmailProviderDto,
  UpdateEmailAutomationDto,
} from './dto/email-provider.dto'
import { EmailAutomationService } from './email-automation.service'

@Controller('admin/notifications/email')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ONLY_ROLES)
export class EmailAutomationController {
  constructor(private readonly email: EmailAutomationService) {}

  @Get('status')
  status() {
    return this.email.status()
  }

  @Post('connection')
  connect(
    @Body() body: ConnectEmailProviderDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.email.connectProvider(body, request.user.id)
  }

  @Delete('connection')
  disconnect(@Req() request: AuthenticatedRequest) {
    return this.email.disconnectProvider(request.user.id)
  }

  @Patch('automation')
  automation(
    @Body() body: UpdateEmailAutomationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.email.setAutomationEnabled(
      body.enabled,
      request.user.id,
    )
  }

  @Get('outbox')
  outbox(@Query('limit') limit = '50') {
    const parsed = Number.parseInt(limit, 10)
    return this.email.recent(Number.isFinite(parsed) ? parsed : 50)
  }

  @Post('process')
  process() {
    return this.email.processNow()
  }

  @Post('test')
  test() {
    return this.email.sendTestEmail()
  }
}
