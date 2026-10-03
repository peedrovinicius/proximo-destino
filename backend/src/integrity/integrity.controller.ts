import { Controller, Get, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { IntegrityService } from './integrity.service'

@Controller('admin/system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class IntegrityController {
  constructor(private readonly integrity: IntegrityService) {}

  @Get('integrity')
  check() {
    return this.integrity.check()
  }

  @Get('security')
  security() {
    return this.integrity.securityPosture()
  }
}
