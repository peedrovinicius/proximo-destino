import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller'
import { ClientsModule } from './clients/clients.module'
import { PrismaModule } from './prisma/prisma.module'
import { TripsModule } from './trips/trips.module'
import { UsersModule } from './users/users.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    PrismaModule,
    UsersModule,
    ClientsModule,
    TripsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
