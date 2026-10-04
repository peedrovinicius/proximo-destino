type EventCount = { eventType: string; count: number }

export function securityAlertSeed(windowStart: number, events: EventCount[]) {
  const count = (type: string) => events.find(event => event.eventType === type)?.count ?? 0
  const failures = count('LOGIN_FAILED')
  const locks = count('LOGIN_LOCKED')
  const mfaFailures = count('MFA_FAILED')
  const roleDenials = count('LOGIN_ROLE_DENIED')
  if (locks < 1 && failures < 10 && mfaFailures < 8 && roleDenials < 5) return null

  return {
    type: 'SECURITY_AUTH_ANOMALY',
    title: 'Atenção à segurança do acesso',
    message: `Atividade de autenticação exige revisão: ${failures} falha(s) de login, ` +
      `${locks} bloqueio(s), ${mfaFailures} falha(s) de MFA e ${roleDenials} negativa(s) de perfil. ` +
      'Consulte a auditoria antes de liberar acessos. Janela de 10 minutos iniciada em ' +
      new Date(windowStart).toISOString() + '.',
    sourceKey: `security-auth:${windowStart}`,
    actionTab: 'audit',
  }
}
