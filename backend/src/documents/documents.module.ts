import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import {
  AdminDocumentsController,
  PublicDocumentsController,
} from './documents.controller'
import { DocumentsService } from './documents.service'

@Module({
  imports: [AuthModule],
  controllers: [AdminDocumentsController, PublicDocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
