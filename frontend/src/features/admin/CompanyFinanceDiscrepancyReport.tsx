import { useEffect, useMemo, useState } from 'react'
import { adminApi, type CompanyFinanceDiscrepancyIssue, type CompanyFinanceDiscrepancyReportPage } from '../../lib/adminApi'
import './CompanyFinanceDiscrepancyReport.css'

const issueLabels: Record<CompanyFinanceDiscrepancyIssue, string> = {
  ORDER_AMOUNT_MISMATCH: 'Valores do pedido incompatíveis',
  REFUND_STATUS_MISMATCH: 'Status e reembolso divergentes',
  PASSENGER_COUNT_MISMATCH: 'Quantidade de passageiros divergente',
  PROVIDER_REFERENCE_MISSING: 'Referência do provedor ausente',
  INVALID_MANUAL_AMOUNT: 'Valor de recebimento manual inválido',
  MANUAL_ASSOCIATION_MISMATCH: 'Plano, parcela ou cotação incompatível',
  MIXED_PAYMENT_CHANNELS_REVIEW: 'Pagamento online e manual na mesma reserva',
}
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function CompanyFinanceDiscrepancyReport({ accessToken }: { accessToken: string }) {
  const [cursorHistory, setCursorHistory] = useState<string[]>([''])
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState<CompanyFinanceDiscrepancyReportPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [issue, setIssue] = useState<'ALL' | CompanyFinanceDiscrepancyIssue>('ALL')
  const [reservationQuery, setReservationQuery] = useState('')
  const cursor = cursorHistory[cursorHistory.length - 1]

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setPage(null)
    void adminApi.companyFinanceDiscrepancies(accessToken, cursor || undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.reportOnly !== true || result.dataModified !== false ||
          result.providerContacted !== false || result.paymentsEnabled !== false ||
          result.pageScoped !== true || result.pageSize !== 50 ||
          !Array.isArray(result.divergences)) {
          throw new Error('Resposta inválida do relatório financeiro.')
        }
        setPage(result)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'Não foi possível consultar as divergências.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [accessToken, cursor, revision])

  const filtered = useMemo(() => {
    const query = reservationQuery.trim().toLowerCase()
    return (page?.divergences ?? []).filter((item) =>
      (issue === 'ALL' || item.issues.includes(issue)) &&
      (!query || item.reservationId.toLowerCase().includes(query)))
  }, [page, issue, reservationQuery])

  return (
    <section className="company-finance-report" aria-labelledby="company-finance-report-title">
      <div className="company-finance-report__header">
        <div>
          <span className="eyebrow">Conferência financeira</span>
          <h3 id="company-finance-report-title">Divergências para revisão</h3>
          <p>Consulta somente leitura, limitada à sua empresa. Os alertas são indícios para conferir,
            não comprovam cobrança duplicada nem confirmam quitação.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>
          Atualizar relatório
        </button>
      </div>
      <p className="company-finance-report__notice">
        Cada página examina até 50 reservas. Contagens e filtros mostram somente a página atual,
        não o resultado de toda a empresa. Nenhum pagamento ou conciliação é executado.
      </p>

      {loading ? <p role="status" aria-live="polite">Consultando divergências financeiras…</p> : null}
      {error ? (
        <div className="company-finance-report__error" role="alert">
          <p>Não foi possível atualizar o relatório: {error}</p>
          <button type="button" onClick={() => setRevision(value => value + 1)}>Tentar novamente</button>
        </div>
      ) : null}

      {page && !loading ? (
        <>
          <p className="company-finance-report__summary" role="status" aria-live="polite">
            Página {cursorHistory.length}: {page.scannedReservations} reservas examinadas,
            {' '}{page.flaggedReservations} com alertas ({page.issueCount} ocorrências).
          </p>
          <div className="company-finance-report__filters">
            <label>
              <span>Buscar código de reserva nesta página</span>
              <input type="search" value={reservationQuery}
                onChange={event => setReservationQuery(event.target.value)}
                placeholder="Identificador da reserva" />
            </label>
            <label>
              <span>Tipo de divergência nesta página</span>
              <select value={issue} onChange={event => setIssue(event.target.value as typeof issue)}>
                <option value="ALL">Todos os tipos</option>
                {Object.entries(issueLabels).map(([code, label]) =>
                  <option value={code} key={code}>{label}</option>)}
              </select>
            </label>
          </div>
          <p className="company-finance-report__filter-status" role="status">
            {filtered.length} reserva(s) com alertas nos filtros desta página.
          </p>
          {filtered.length ? (
            <ul className="company-finance-report__list" aria-label="Reservas com divergências nesta página">
              {filtered.map(item => (
                <li className="company-finance-report__item" key={item.reservationId}>
                  <h4>Reserva <span>{item.reservationId}</span></h4>
                  <ul aria-label={`Alertas da reserva ${item.reservationId}`}>
                    {item.issues.map(code => <li key={code}>{issueLabels[code] ?? 'Pendência para revisão'}</li>)}
                  </ul>
                  <div className="company-finance-report__amounts">
                    {item.online ? (
                      <p><strong>Pedido online:</strong> {money.format(item.online.totalCents / 100)}
                        {' · '}Status: {item.online.status}
                        {' · '}Reembolso: {money.format(item.online.refundedCents / 100)}</p>
                    ) : <p><strong>Pedido online:</strong> não registrado</p>}
                    <p><strong>Recebimentos manuais:</strong> {item.manual.receivedCount} registro(s),
                      {' '}{money.format(item.manual.receivedCents / 100)} recebido(s),
                      {' '}{money.format(item.manual.reversedCents / 100)} revertido(s)</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="company-finance-report__empty">
              {page.flaggedReservations === 0
                ? 'Nenhuma divergência identificada entre as reservas examinadas nesta página.'
                : 'Nenhuma reserva corresponde aos filtros desta página.'}
            </p>
          )}
          <nav className="company-finance-report__pagination" aria-label="Páginas do relatório financeiro">
            <button type="button" disabled={cursorHistory.length === 1}
              onClick={() => setCursorHistory(current => current.slice(0, -1))}>
              Página anterior
            </button>
            <span>Página {cursorHistory.length}</span>
            <button type="button" disabled={!page.nextCursor} onClick={() => {
              if (page.nextCursor) setCursorHistory(current => [...current, page.nextCursor!])
            }}>
              Próxima página
            </button>
          </nav>
        </>
      ) : null}
    </section>
  )
}
