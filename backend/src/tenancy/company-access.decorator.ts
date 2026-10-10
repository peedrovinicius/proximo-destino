import { SetMetadata } from '@nestjs/common'
export const COMPANY_ACCESS = 'company_access_mode'
export const CompanyRead = () => SetMetadata(COMPANY_ACCESS, 'SCOPED_READ')
export const CompanyWrite = () => SetMetadata(COMPANY_ACCESS, 'SCOPED_WRITE')
export const OwnSessionAccess = () => SetMetadata(COMPANY_ACCESS, 'SELF')
