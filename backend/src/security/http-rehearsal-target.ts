// This temporary target was resolved by the Neon connector from the isolated
// branch br-lucky-dawn-b5d1ehsg. Never accept a host supplied by an environment flag.
export const HTTP_REHEARSAL_HOST = 'ep-lively-breeze-b535rkug.c-7.us-east-2.aws.neon.tech'
export const HTTP_REHEARSAL_EXPIRES = Date.parse('2026-10-08T23:37:27Z')
const databasePattern = /^validation_pr34_http_[a-f0-9]{24}$/

export function assertHttpRehearsalTarget(database: URL, now = Date.now()) {
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
    database.hostname !== HTTP_REHEARSAL_HOST || now >= HTTP_REHEARSAL_EXPIRES ||
    !databasePattern.test(database.pathname.slice(1)) ||
    database.username !== 'neondb_owner' || !database.password || database.hash ||
    (database.port !== '' && database.port !== '5432') ||
    !['require', 'verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode') || '') ||
    [...database.searchParams.keys()].some(key => !['sslmode', 'schema', 'connect_timeout', 'channel_binding'].includes(key) ||
      database.searchParams.getAll(key).length !== 1) ||
    (database.searchParams.has('channel_binding') && database.searchParams.get('channel_binding') !== 'require') ||
    (database.searchParams.has('schema') && database.searchParams.get('schema') !== 'public')) {
    throw new Error('Destino HTTP isolado inválido ou expirado; nenhuma operação autorizada')
  }
}

export function assertRestrictedHttpTestTarget(database: URL) {
  if (process.env.NODE_ENV !== 'test') throw new Error('NODE_ENV=test obrigatório')
  if (['localhost', '127.0.0.1', 'postgres'].includes(database.hostname)) return
  assertHttpRehearsalTarget(database)
}
