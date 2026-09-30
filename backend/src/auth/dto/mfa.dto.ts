import { IsString, Length, MaxLength, MinLength } from 'class-validator'

export class MfaChallengeDto {
  @IsString()
  @MinLength(20)
  challengeToken!: string
}

export class MfaVerifyDto extends MfaChallengeDto {
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code!: string
}

export class RevokeSessionDto {
  @IsString()
  @Length(25, 64)
  sessionId!: string
}
