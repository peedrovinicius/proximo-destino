import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuditService } from './audit.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './jwt-auth.guard'
import { MfaService } from './mfa.service'
import { RolesGuard } from './roles.guard'
import { SessionService } from './session.service'

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    SessionService,
    AuditService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
