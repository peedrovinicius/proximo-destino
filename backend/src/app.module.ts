import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AdminModule } from './admin/admin.module'
import { AppController } from './app.controller'
import { AuthModule } from './auth/auth.module'
import { ClientsModule } from './clients/clients.module'
import { PortalModule } from './portal/portal.module'
import { PrismaModule } from './prisma/prisma.module'
import { SecurityModule } from './security/security.module'
import { TripsModule } from './trips/trips.module'
import { UsersModule } from './users/users.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    SecurityModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    TripsModule,
    AdminModule,
    PortalModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
