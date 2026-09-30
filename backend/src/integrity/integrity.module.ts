import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { IntegrityController } from './integrity.controller'
import { IntegrityService } from './integrity.service'

@Module({
  imports: [AuthModule],
  controllers: [IntegrityController],
  providers: [IntegrityService],
})
export class IntegrityModule {}
