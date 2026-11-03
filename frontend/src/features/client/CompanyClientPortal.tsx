import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CompanyPortalError, loginCompanyClient, logoutCompanyClient, readCompanyPortal, type CompanyPortalData } from '../../lib/companyClientPortalApi'
import '../home/company-catalog.css'

const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' })
const statuses: Record<string, string> = { PENDING: 'Pendente', CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada', COMPLETED: 'Concluída' }

export function CompanyClientPortal({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [reservationId, setReservationId] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [session, setSession] = useState<{ token: string; expiresAt: number } | null>(null)
  const [data, setData] = useState<CompanyPortalData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => () => { pending.current?.abort() }, [])
  useEffect(() => {
    document.title = data ? `${data.company.tradeName} | Minha reserva` : 'Minha reserva'
    return () => { document.title = 'Próximo Destino' }
  }, [data])
  useEffect(() => {
    if (!session) return
    const expire = () => {
      pending.current?.abort(); setSession(null); setData(null); setBusy(false)
      setCode(''); setError('Sua sessão expirou. Entre novamente.'); setNotice('')
    }
    const remaining = session.expiresAt - Date.now()
    if (remaining <= 0) { expire(); return }
    const timer = window.setTimeout(expire, remaining)
    const onVisible = () => { if (Date.now() >= session.expiresAt) expire() }
    window.addEventListener('focus', onVisible)
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', onVisible) }
  }, [session])
  useEffect(() => { if (data) heading.current?.focus() }, [data])

  function start() {
    pending.current?.abort()
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError(''); setNotice(''); setData(null)
    return controller
  }
  function failed(cause: unknown, controller: AbortController) {
    if (controller.signal.aborted) return
    setData(null)
    if (cause instanceof CompanyPortalError && [401, 404].includes(cause.status)) setSession(null)
    setError(cause instanceof Error ? cause.message : 'Consulta indisponível.')
  }
  async function login(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const controller = start()
    const input = { reservationId: reservationId.trim(), email: email.trim(), code: code.trim() }
    setCode('')
    try {
      const result = await loginCompanyClient(slug, input, controller.signal)
      if (controller.signal.aborted) return
      const expiresAt = Date.parse(result.expiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new CompanyPortalError(401)
      setSession({ token: result.accessToken, expiresAt })
      const reservation = await readCompanyPortal(slug, result.accessToken, controller.signal)
      if (!controller.signal.aborted) setData(reservation)
    } catch (cause) { failed(cause, controller) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  async function refresh() {
    if (!session || busy) return
    const controller = start()
    try {
      const result = await readCompanyPortal(slug, session.token, controller.signal)
      if (!controller.signal.aborted) setData(result)
    } catch (cause) { failed(cause, controller) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  async function logout() {
    if (!session || busy) return
    const controller = start()
    try {
      await logoutCompanyClient(slug, session.token, controller.signal)
      if (controller.signal.aborted) return
      setSession(null); setEmail(''); setReservationId(''); setCode(''); setNotice('Sessão encerrada.')
    } catch (cause) {
      failed(cause, controller)
      if (!controller.signal.aborted && !(cause instanceof CompanyPortalError && [401, 404].includes(cause.status))) {
        setError('Não foi possível confirmar o encerramento no servidor. Tente sair novamente.')
      }
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <main className="company-catalog company-client-portal">
    <button type="button" onClick={onBack} disabled={busy}>Voltar ao catálogo da empresa</button>
    <header className="company-catalog-heading"><span>Acesso do viajante</span>
      <h1 tabIndex={-1} ref={heading}>{data?.company.tradeName ?? 'Minha reserva'}</h1>
      <p>Consulte os dados da sua reserva nesta empresa. Alterações e pagamentos ainda não estão disponíveis neste acesso.</p>
    </header>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {busy ? <p role="status">Consultando…</p> : null}
    {!session ? <form className="company-client-login" onSubmit={login} autoComplete="off">
      <label>Identificador da reserva<input required maxLength={128} value={reservationId} onChange={e => setReservationId(e.target.value)} disabled={busy} /></label>
      <label>E-mail da reserva<input required type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label>
      <label>Código de acesso<input required type="password" minLength={6} maxLength={128} autoComplete="off" value={code} onChange={e => setCode(e.target.value)} disabled={busy} /></label>
      <button disabled={busy}>Consultar minha reserva</button>
      <p>Use os dados fornecidos pela empresa. Por segurança, recarregar ou fechar esta página exige novo login.</p>
    </form> : <div className="company-client-actions">
      <button type="button" onClick={() => void refresh()} disabled={busy}>Atualizar reserva</button>
      <button type="button" onClick={() => void logout()} disabled={busy}>Sair da reserva</button>
    </div>}
    {data ? <article className="company-catalog-card company-catalog-detail">
      <span>{data.reservation.trip.origin} → {data.reservation.trip.destination}</span><h2>{data.reservation.trip.title}</h2>
      <dl><div><dt>Situação</dt><dd>{statuses[data.reservation.status] ?? 'Em análise'}</dd></div>
        <div><dt>Passageiros</dt><dd>{data.reservation.passengerCount}</dd></div>
        <div><dt>Partida</dt><dd>{date.format(new Date(data.reservation.trip.departureDate))}</dd></div>
        {data.reservation.trip.returnDate ? <div><dt>Retorno</dt><dd>{date.format(new Date(data.reservation.trip.returnDate))}</dd></div> : null}
        <div><dt>Poltronas da reserva</dt><dd>{data.reservation.seats.length ? data.reservation.seats.join(', ') : 'Sem poltrona atribuída'}</dd></div>
      </dl><p>Consulta somente leitura.</p>
    </article> : null}
  </main>
}
