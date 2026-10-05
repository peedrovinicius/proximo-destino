import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuditService } from './audit.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './jwt-auth.guard'
import { MfaService } from './mfa.service'
import { RolesGuard } from './roles.guard'
import { SessionService } from './session.service'
import { TenancyModule } from '../tenancy/tenancy.module'

@Module({
  imports: [JwtModule.register({}), TenancyModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    SessionService,
    AuditService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [MfaService, AuthService, JwtAuthGuard, RolesGuard, TenancyModule],
})
export class AuthModule {}
