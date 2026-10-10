import { useEffect, useRef, useState, type FormEvent } from 'react'
import { adminApi, type AdminReservation } from '../../lib/adminApi'
import './reservation-access.css'

type IssuedAccess = { code: string; expiresAt: string }

export function ReservationAccessDialog({ token, reservation, onClose }: {
  token: string; reservation: AdminReservation; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<IssuedAccess | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const codeInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    mounted.current = true
    const element = dialog.current
    element?.showModal()
    return () => { mounted.current = false; element?.close() }
  }, [])
  useEffect(() => {
    if (!issued) return
    codeInput.current?.focus()
    codeInput.current?.select()
    const timer = window.setTimeout(() => {
      setIssued(null)
      setNotice('O prazo deste código terminou. Gere outro se o cliente precisar de acesso.')
    }, Math.max(0, new Date(issued.expiresAt).getTime() - Date.now()))
    return () => window.clearTimeout(timer)
  }, [issued])

  async function change(issue: boolean) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true); setIssued(null); setError(''); setNotice('')
    try {
      if (issue) {
        const result = await adminApi.issueCompanyPortalCode(token, reservation.id)
        if (result.reservationId !== reservation.id || result.delivery !== 'MANUAL_PRIVATE' ||
          !/^[A-F0-9]{48}$/.test(result.code) || !Number.isFinite(Date.parse(result.expiresAt)) ||
          Date.parse(result.expiresAt) <= Date.now()) throw new Error('Resposta de acesso inválida. Gere um novo código.')
        if (mounted.current) setIssued({ code: result.code, expiresAt: result.expiresAt })
      } else {
        await adminApi.revokeCompanyPortalCode(token, reservation.id)
        if (mounted.current) setNotice('Acesso revogado. O código e as sessões anteriores desta reserva foram encerrados.')
      }
    } catch (cause) {
      if (mounted.current) setError(`${cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.'} ${issue ? 'Nenhum código foi exibido. Se a resposta foi interrompida, gere outro para substituir qualquer código anterior.' : 'Não foi possível confirmar a revogação. Tente revogar novamente.'}`)
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  function issue(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void change(true) }

  return <dialog ref={dialog} className="reservation-access-dialog" aria-labelledby="reservation-access-title"
    onCancel={event => { event.preventDefault(); if (!inFlight.current) onClose() }}>
    <h2 id="reservation-access-title">Acesso do cliente ao portal</h2>
    <p>{reservation.client.fullName} · {reservation.trip.title}</p>
    <label>Identificador da reserva<input readOnly value={reservation.id} onFocus={event => event.currentTarget.select()} /></label>
    <p>O cliente usa o identificador, o e-mail cadastrado e o código no portal da empresa. Entregue esses dados em conversa privada após conferir o destinatário.</p>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {issued ? <section className="reservation-access-result" aria-label="Código gerado">
      <label>Código de acesso<input ref={codeInput} readOnly value={issued.code} autoComplete="off"
        spellCheck={false} onFocus={event => event.currentTarget.select()} /></label>
      <p>Válido até {new Date(issued.expiresAt).toLocaleString('pt-BR')}. Exibido somente nesta janela; ao fechar, ele será removido da tela.</p>
      <p>O código anterior e as sessões anteriores foram revogados. O cliente ainda não foi avisado.</p>
    </section> : null}
    <form onSubmit={issue}><fieldset disabled={busy}>
      {reservation.companyPortalAccess?.canIssue ? <>
        <label className="reservation-access-confirmation"><input type="checkbox" required name="privateDelivery" />
          Vou entregar o código em canal privado ao cliente correto.</label>
        <p>Gerar um código substitui qualquer código anterior e encerra as sessões desta reserva. O cliente precisa ter e-mail cadastrado.</p>
        <button type="submit">{busy ? 'Aguarde…' : 'Gerar novo código'}</button>
      </> : <p>A emissão exige uma viagem publicada e uma reserva não cancelada.</p>}
    </fieldset></form>
    <form onSubmit={event => { event.preventDefault(); void change(false) }}><fieldset disabled={busy}>
      <label className="reservation-access-confirmation"><input type="checkbox" required name="confirmRevocation" />
        Confirmo encerrar o código e todas as sessões desta reserva.</label>
      <button type="submit">Revogar acesso</button>
    </fieldset></form>
    <button type="button" disabled={busy} onClick={onClose}>Fechar e ocultar código</button>
  </dialog>
}
