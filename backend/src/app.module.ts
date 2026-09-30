import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AdminModule } from './admin/admin.module'
import { AppController } from './app.controller'
import { AuthModule } from './auth/auth.module'
import { ClientsModule } from './clients/clients.module'
import { CommercialModule } from './commercial/commercial.module'
import { DocumentsModule } from './documents/documents.module'
import { IntegrityModule } from './integrity/integrity.module'
import { PortalModule } from './portal/portal.module'
import { PrivacyModule } from './privacy/privacy.module'
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
    CommercialModule,
    DocumentsModule,
    IntegrityModule,
    TripsModule,
    AdminModule,
    PortalModule,
    PrivacyModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
