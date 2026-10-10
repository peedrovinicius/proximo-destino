import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { TenancyModule } from '../tenancy/tenancy.module'
import { ClientsController } from './clients.controller'
import { ClientsService } from './clients.service'

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
