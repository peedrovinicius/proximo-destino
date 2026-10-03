import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { NotificationsModule } from '../notifications/notifications.module'
import {
  AdminDocumentsController,
  PublicDocumentsController,
} from './documents.controller'
import { DocumentsService } from './documents.service'

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [AdminDocumentsController, PublicDocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
