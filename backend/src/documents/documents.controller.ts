import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard'
import {
  FINANCE_ROLES,
  OPERATIONS_ROLES,
  STAFF_ROLES,
} from '../auth/role-capabilities'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import {
  IssuePurchaseReceiptDto,
  IssueTravelVoucherDto,
} from './dto/document.dto'
import { DocumentsService } from './documents.service'

@Controller('admin/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class AdminDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('reservation/:reservationId')
  list(
    @Param('reservationId') reservationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.listByReservation(
      reservationId,
      request.user.role,
    )
  }

  @Post('reservation/:reservationId/travel-voucher')
  @Roles(...OPERATIONS_ROLES)
  issueVoucher(
    @Param('reservationId') reservationId: string,
    @Body() body: IssueTravelVoucherDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.issueTravelVoucher(
      reservationId,
      request.user.id,
      body,
    )
  }

  @Post('reservation/:reservationId/purchase-receipt')
  @Roles(...FINANCE_ROLES)
  issueReceipt(
    @Param('reservationId') reservationId: string,
    @Body() body: IssuePurchaseReceiptDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.issuePurchaseReceipt(
      reservationId,
      request.user.id,
      body,
    )
  }

  @Get(':id/pdf')
  async pdf(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const result = await this.documents.renderAdminPdf(
      id,
      request.user.role,
    )
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${result.filename}"`,
    )
    response.setHeader('Cache-Control', 'private, no-store')
    response.send(result.buffer)
  }
}

@Controller('public/documents')
export class PublicDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('verify/:code')
  verify(@Param('code') code: string) {
    return this.documents.verify(code)
  }
}
