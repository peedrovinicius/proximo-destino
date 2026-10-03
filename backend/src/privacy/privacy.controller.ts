import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { ADMIN_ONLY_ROLES } from '../auth/role-capabilities'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { PrivacyService } from './privacy.service'

@Controller('admin/privacy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ONLY_ROLES)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('clients/:id/export')
  exportClient(@Param('id') id: string) {
    return this.privacy.exportClient(id)
  }

  @Get('clients/:id/retention')
  retention(@Param('id') id: string) {
    return this.privacy.retentionReport(id)
  }
}
