import {
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Camera,
  Printer,
  QrCode,
  Search,
  UserCheck,
  UserX,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  adminApi,
  type AdminBoardingList,
  type BoardingStatus,
} from '../../lib/adminApi'

type Props = {
  accessToken: string
  tripId: string
  onClose: () => void
  onCompleted: () => Promise<void>
}

const statusLabel: Record<BoardingStatus, string> = {
  PENDING: 'Aguardando',
  BOARDED: 'Embarcou',
  ABSENT: 'Ausente',
}

function csvCell(value: string | number | null | undefined) {
  const normalized = String(value ?? '')
  return '"' + normalized.replace(/"/g, '""') + '"'
}

function html(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function safeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

export function TripBoardingDialog({
  accessToken,
  tripId,
  onClose,
  onCompleted,
}: Props) {
  const [data, setData] = useState<AdminBoardingList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'ALL' | BoardingStatus>('ALL')
  const [savingPassengerId, setSavingPassengerId] = useState<string | null>(null)
  const [savingBulk, setSavingBulk] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [qrOpen, setQrOpen] = useState(false)
  const [qrCode, setQrCode] = useState('')
  const [qrScanning, setQrScanning] = useState(false)
  const [qrMessage, setQrMessage] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanFrameRef = useRef<number | null>(null)

  function stopCamera() {
    if (scanFrameRef.current !== null) {
      window.cancelAnimationFrame(scanFrameRef.current)
      scanFrameRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setQrScanning(false)
  }

  async function processQrCode(code: string) {
    const normalized = code.trim()
    if (!normalized) {
      setError('Informe ou leia um QR Code válido.')
      return
    }

    setQrScanning(true)
    setError('')
    setQrMessage('')

    try {
      const result = await adminApi.scanBoardingQr(
        accessToken,
        tripId,
        normalized,
      )

      stopCamera()
      setSelectedIds(new Set(result.passengerIds))
      setFilter('ALL')
      setQuery(result.reservationId)
      setQrCode(normalized)
      setQrMessage(
        `Reserva de ${result.clientName} localizada: ${result.passengerIds.length} passageiro(s) selecionado(s). Confira e toque em Embarcar para confirmar.`,
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível validar este QR Code.',
      )
      setQrScanning(Boolean(streamRef.current))
    }
  }

  async function startCamera() {
    if (!data?.canUpdate) return

    setQrOpen(true)
    setQrMessage('')
    setError('')

    const Detector = (
      window as unknown as {
        BarcodeDetector?: new (options?: { formats?: string[] }) => {
          detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>
        }
      }
    ).BarcodeDetector

    if (!Detector) {
      setQrMessage(
        'A leitura automática de QR não está disponível neste navegador. Cole o código ou o link da passagem abaixo.',
      )
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream

      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      )

      const video = videoRef.current
      if (!video) {
        stopCamera()
        return
      }

      video.srcObject = stream
      await video.play()
      setQrScanning(true)

      const detector = new Detector({ formats: ['qr_code'] })
      let busy = false

      const scan = async () => {
        if (!streamRef.current || !videoRef.current) return

        if (!busy && videoRef.current.readyState >= 2) {
          busy = true
          try {
            const codes = await detector.detect(videoRef.current)
            const raw = codes.find((item) => item.rawValue)?.rawValue
            if (raw) {
              await processQrCode(raw)
              if (!streamRef.current) return
            }
          } catch {
            // continua tentando enquanto a câmera estiver ativa
          } finally {
            busy = false
          }
        }

        if (streamRef.current) {
          scanFrameRef.current = window.requestAnimationFrame(() => {
            void scan()
          })
        }
      }

      void scan()
    } catch {
      stopCamera()
      setQrMessage(
        'Não foi possível acessar a câmera. Autorize o uso da câmera ou cole o código da passagem abaixo.',
      )
    }
  }

  useEffect(() => {
    let active = true

    void adminApi.boardingList(accessToken, tripId)
      .then((result) => {
        if (active) setData(result)
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar a lista de embarque.',
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      active = false
      stopCamera()
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [accessToken, onClose, tripId])

  const filteredPassengers = useMemo(() => {
    if (!data) return []

    const normalizedQuery = query.trim().toLowerCase()

    return data.passengers.filter((passenger) => {
      if (filter !== 'ALL' && passenger.boardingStatus !== filter) return false
      if (!normalizedQuery) return true

      const searchable = [
        passenger.fullName,
        passenger.document,
        passenger.reservation.client.fullName,
        passenger.reservation.id,
        passenger.seatAssignment?.seatNumber?.toString(),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchable.includes(normalizedQuery)
    })
  }, [data, filter, query])

  const selectedCount = selectedIds.size
  const filteredIds = useMemo(
    () => filteredPassengers.map((passenger) => passenger.id),
    [filteredPassengers],
  )
  const allFilteredSelected =
    filteredIds.length > 0 &&
    filteredIds.every((id) => selectedIds.has(id))

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allFilteredSelected) {
        filteredIds.forEach((id) => next.delete(id))
      } else {
        filteredIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  async function updateStatus(
    passengerId: string,
    status: BoardingStatus,
  ) {
    if (!data?.canUpdate || savingPassengerId || savingBulk) return

    setSavingPassengerId(passengerId)
    setError('')

    try {
      setData(
        await adminApi.updateBoardingStatus(
          accessToken,
          tripId,
          passengerId,
          status,
        ),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível atualizar o embarque.',
      )
    } finally {
      setSavingPassengerId(null)
    }
  }

  async function bulkUpdate(status: BoardingStatus) {
    if (!data?.canUpdate || !selectedIds.size || savingBulk) return

    setSavingBulk(true)
    setError('')

    try {
      setData(
        await adminApi.bulkUpdateBoardingStatus(
          accessToken,
          tripId,
          [...selectedIds],
          status,
        ),
      )
      setSelectedIds(new Set())
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível atualizar os passageiros selecionados.',
      )
    } finally {
      setSavingBulk(false)
    }
  }

  async function completeTrip() {
    if (!data || data.summary.pending > 0 || completing) return

    setCompleting(true)
    setError('')

    try {
      await adminApi.completeTrip(accessToken, tripId)
      const refreshed = await adminApi.boardingList(accessToken, tripId)
      setData(refreshed)
      setConfirmComplete(false)
      setSelectedIds(new Set())
      await onCompleted()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível concluir a viagem.',
      )
    } finally {
      setCompleting(false)
    }
  }

  function exportCsv() {
    if (!data) return

    const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' })
      .format(new Date(data.trip.departureDate))
    const time = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })

    const rows = [
      ['Viagem', data.trip.title],
      ['Rota', data.trip.origin + ' → ' + data.trip.destination],
      ['Data', date],
      ['Total', data.summary.total],
      ['Embarcaram', data.summary.boarded],
      ['Ausentes', data.summary.absent],
      ['Aguardando', data.summary.pending],
      [],
      ['Assento', 'Passageiro', 'Tipo', 'Documento', 'Reserva', 'Telefone', 'Status', 'Horário do embarque'],
      ...data.passengers.map((passenger) => [
        passenger.seatAssignment?.seatNumber ?? '',
        passenger.fullName?.trim() ||
          'Passageiro ' + passenger.sequence + ' · ' + passenger.reservation.client.fullName,
        passenger.isPrimary ? 'Titular' : 'Acompanhante',
        passenger.document ?? '',
        passenger.reservation.id,
        passenger.reservation.client.phone ?? '',
        statusLabel[passenger.boardingStatus],
        passenger.boardedAt ? time.format(new Date(passenger.boardedAt)) : '',
      ]),
    ]

    const csv = '\ufeff' + rows
      .map((row) => row.map((cell) => csvCell(cell)).join(';'))
      .join('\r\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download =
      'embarque-' +
      (safeFileName(data.trip.title) || 'viagem') +
      '-' +
      new Date(data.trip.departureDate).toISOString().slice(0, 10) +
      '.csv'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function printList() {
    if (!data) return

    const popup = window.open('', '_blank', 'width=1000,height=760')
    if (!popup) {
      setError('O navegador bloqueou a janela de impressão.')
      return
    }

    const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' })
      .format(new Date(data.trip.departureDate))
    const time = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })

    const rows = data.passengers.map((passenger) => {
      const name =
        passenger.fullName?.trim() ||
        'Passageiro ' + passenger.sequence + ' · ' + passenger.reservation.client.fullName
      return `
        <tr>
          <td>${html(passenger.seatAssignment?.seatNumber ?? '—')}</td>
          <td><strong>${html(name)}</strong><br><small>${html(passenger.isPrimary ? 'Titular' : 'Acompanhante')}</small></td>
          <td>${html(passenger.document || '—')}</td>
          <td>${html(passenger.reservation.id.slice(-8).toUpperCase())}</td>
          <td>${html(statusLabel[passenger.boardingStatus])}</td>
          <td>${html(passenger.boardedAt ? time.format(new Date(passenger.boardedAt)) : '—')}</td>
        </tr>
      `
    }).join('')

    popup.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Lista de embarque - ${html(data.trip.title)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #172b3a; font: 12px Arial, sans-serif; }
  header { border-bottom: 2px solid #172b3a; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { margin: 0 0 5px; font-size: 22px; }
  p { margin: 3px 0; color: #52697c; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0 18px; }
  .summary div { border: 1px solid #d8e0e6; border-radius: 7px; padding: 9px; text-align: center; }
  .summary strong { display: block; font-size: 18px; }
  .summary span { color: #647787; font-size: 9px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #eef3f6; text-align: left; font-size: 9px; text-transform: uppercase; }
  th, td { border: 1px solid #d9e1e7; padding: 7px; vertical-align: top; }
  td:first-child { text-align: center; font-weight: 700; }
  small { color: #6f8190; }
  footer { margin-top: 14px; color: #7b8995; font-size: 9px; }
</style>
</head>
<body>
<header>
  <h1>Lista de embarque</h1>
  <p><strong>${html(data.trip.title)}</strong></p>
  <p>${html(data.trip.origin)} → ${html(data.trip.destination)} · ${html(date)}</p>
</header>
<section class="summary">
  <div><strong>${data.summary.total}</strong><span>Total</span></div>
  <div><strong>${data.summary.boarded}</strong><span>Embarcaram</span></div>
  <div><strong>${data.summary.absent}</strong><span>Ausentes</span></div>
  <div><strong>${data.summary.pending}</strong><span>Aguardando</span></div>
</section>
<table>
  <thead><tr><th>Assento</th><th>Passageiro</th><th>Documento</th><th>Reserva</th><th>Status</th><th>Horário</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<footer>Gerado pela plataforma Próximo Destino em ${html(new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()))}.</footer>
</body>
</html>`)
    popup.document.close()
    popup.focus()
    window.setTimeout(() => popup.print(), 250)
  }

  return (
    <div
      className="boarding-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="boarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="boarding-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="boarding-header">
          <div>
            <span>Operação de embarque</span>
            <h2 id="boarding-title">
              {data?.trip.title ?? 'Lista de embarque'}
            </h2>
            {data ? (
              <small>
                {data.trip.origin} → {data.trip.destination}
                {' · '}
                {new Intl.DateTimeFormat('pt-BR', {
                  dateStyle: 'medium',
                }).format(new Date(data.trip.departureDate))}
              </small>
            ) : null}
          </div>

          <button type="button" onClick={onClose} aria-label="Fechar lista de embarque">
            <X size={21} />
          </button>
        </header>

        {error ? <div className="boarding-error">{error}</div> : null}

        {data ? (
          <div className="boarding-summary">
            <button
              type="button"
              className={filter === 'ALL' ? 'active' : ''}
              onClick={() => setFilter('ALL')}
            >
              <strong>{data.summary.total}</strong>
              <span>Total</span>
            </button>
            <button
              type="button"
              className={filter === 'PENDING' ? 'active' : ''}
              onClick={() => setFilter('PENDING')}
            >
              <strong>{data.summary.pending}</strong>
              <span>Aguardando</span>
            </button>
            <button
              type="button"
              className={filter === 'BOARDED' ? 'active' : ''}
              onClick={() => setFilter('BOARDED')}
            >
              <strong>{data.summary.boarded}</strong>
              <span>Embarcaram</span>
            </button>
            <button
              type="button"
              className={filter === 'ABSENT' ? 'active' : ''}
              onClick={() => setFilter('ABSENT')}
            >
              <strong>{data.summary.absent}</strong>
              <span>Ausentes</span>
            </button>
          </div>
        ) : null}

        {data ? (
          <section className={
            'boarding-completion ' +
            (data.trip.status === 'COMPLETED'
              ? 'boarding-completion--done'
              : data.summary.pending > 0
                ? 'boarding-completion--pending'
                : 'boarding-completion--ready')
          }>
            <div className="boarding-completion-copy">
              <CheckCircle2 size={18} />
              <div>
                <strong>
                  {data.trip.status === 'COMPLETED'
                    ? 'Viagem concluída'
                    : data.summary.pending > 0
                      ? 'Encerramento pendente'
                      : 'Pronta para encerramento'}
                </strong>
                <span>
                  {data.trip.status === 'COMPLETED'
                    ? 'A operação foi encerrada e as reservas ativas foram concluídas.'
                    : data.summary.pending > 0
                      ? data.summary.pending + ' passageiro(s) ainda precisam ser marcados como Embarcou ou Ausente.'
                      : data.summary.boarded + ' embarcaram · ' + data.summary.absent + ' ausente(s) · nenhum passageiro aguardando.'}
                </span>
              </div>
            </div>

            {data.trip.status !== 'COMPLETED' && data.trip.status !== 'CANCELLED' ? (
              data.summary.pending > 0 ? (
                <button
                  type="button"
                  disabled
                  title="Resolva todos os passageiros aguardando antes de concluir"
                >
                  Concluir viagem
                </button>
              ) : confirmComplete ? (
                <div className="boarding-completion-confirm">
                  <span>Confirma o encerramento definitivo desta viagem?</span>
                  <button
                    type="button"
                    className="confirm"
                    disabled={completing}
                    onClick={() => void completeTrip()}
                  >
                    {completing ? 'Concluindo...' : 'Sim, concluir'}
                  </button>
                  <button
                    type="button"
                    className="cancel"
                    disabled={completing}
                    onClick={() => setConfirmComplete(false)}
                  >
                    Voltar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmComplete(true)}
                >
                  Conferir e concluir
                </button>
              )
            ) : null}
          </section>
        ) : null}

        <div className="boarding-toolbar">
          <label className="boarding-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar passageiro, assento ou reserva"
            />
          </label>

          <div className="boarding-document-actions">
            {data?.canUpdate ? (
              <button
                type="button"
                className="boarding-qr-open"
                onClick={() => {
                  setQrOpen(true)
                  void startCamera()
                }}
              >
                <QrCode size={14} />
                Ler QR
              </button>
            ) : null}
            <button type="button" onClick={exportCsv} disabled={!data?.passengers.length}>
              <Download size={14} />
              CSV
            </button>
            <button type="button" onClick={printList} disabled={!data?.passengers.length}>
              <Printer size={14} />
              Imprimir
            </button>
          </div>

          {data && !data.canUpdate ? (
            <span className="boarding-readonly">
              Operação encerrada
            </span>
          ) : null}
        </div>

        {qrOpen && data?.canUpdate ? (
          <section className="boarding-qr-panel">
            <div className="boarding-qr-panel-head">
              <div>
                <span>Check-in por QR Code</span>
                <strong>Localizar passagem</strong>
              </div>
              <button
                type="button"
                onClick={() => {
                  stopCamera()
                  setQrOpen(false)
                  setQrMessage('')
                }}
                aria-label="Fechar leitor de QR"
              >
                <X size={17} />
              </button>
            </div>

            <div className="boarding-qr-camera">
              <video
                ref={videoRef}
                muted
                playsInline
                aria-label="Câmera para leitura do QR Code"
              />
              <span className="boarding-qr-frame" aria-hidden="true" />
              <div className="boarding-qr-camera-copy">
                <Camera size={17} />
                <span>
                  {qrScanning
                    ? 'Aponte a câmera para o QR da passagem'
                    : 'Câmera inativa'}
                </span>
              </div>
            </div>

            <div className="boarding-qr-manual">
              <label>
                <span>Código ou link da passagem</span>
                <input
                  value={qrCode}
                  onChange={(event) => setQrCode(event.target.value)}
                  placeholder="Cole o QR, código ou link de verificação"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void processQrCode(qrCode)
                    }
                  }}
                />
              </label>
              <button
                type="button"
                disabled={!qrCode.trim() || qrScanning}
                onClick={() => void processQrCode(qrCode)}
              >
                <QrCode size={14} />
                Validar
              </button>
              {!qrScanning ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void startCamera()}
                >
                  <Camera size={14} />
                  Usar câmera
                </button>
              ) : null}
            </div>

            {qrMessage ? (
              <div className="boarding-qr-message">
                <CheckCircle2 size={16} />
                <span>{qrMessage}</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {data?.canUpdate && filteredPassengers.length ? (
          <div className="boarding-selection-bar">
            <label>
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleAllFiltered}
              />
              <span>
                {allFilteredSelected
                  ? 'Desmarcar filtrados'
                  : 'Selecionar ' + filteredPassengers.length + ' filtrado(s)'}
              </span>
            </label>

            {selectedCount ? (
              <div>
                <strong>{selectedCount} selecionado(s)</strong>
                <button
                  type="button"
                  className="board"
                  disabled={savingBulk}
                  onClick={() => void bulkUpdate('BOARDED')}
                >
                  Embarcar
                </button>
                <button
                  type="button"
                  className="absent"
                  disabled={savingBulk}
                  onClick={() => void bulkUpdate('ABSENT')}
                >
                  Ausente
                </button>
                <button
                  type="button"
                  className="pending"
                  disabled={savingBulk}
                  onClick={() => void bulkUpdate('PENDING')}
                >
                  Aguardando
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="boarding-list">
          {loading ? (
            <p className="admin-empty">Carregando lista de embarque...</p>
          ) : filteredPassengers.length ? (
            filteredPassengers.map((passenger) => {
              const displayName =
                passenger.fullName?.trim() ||
                `Passageiro ${passenger.sequence} · ${passenger.reservation.client.fullName}`
              const saving = savingPassengerId === passenger.id

              return (
                <article
                  className={
                    'boarding-row boarding-row--' +
                    passenger.boardingStatus.toLowerCase() +
                    (selectedIds.has(passenger.id) ? ' boarding-row--selected' : '')
                  }
                  key={passenger.id}
                >
                  <label className="boarding-select-one" aria-label={'Selecionar ' + displayName}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(passenger.id)}
                      onChange={() => toggleSelection(passenger.id)}
                      disabled={!data?.canUpdate || savingBulk}
                    />
                  </label>

                  <div className="boarding-seat">
                    <span>Assento</span>
                    <strong>{passenger.seatAssignment?.seatNumber ?? '—'}</strong>
                  </div>

                  <div className="boarding-passenger">
                    <strong>{displayName}</strong>
                    <span>
                      {passenger.isPrimary ? 'Titular' : 'Acompanhante'}
                      {' · '}
                      Reserva #{passenger.reservation.id.slice(-8).toUpperCase()}
                    </span>
                    <small>
                      {passenger.document || 'Documento não informado'}
                      {passenger.reservation.client.phone
                        ? ' · ' + passenger.reservation.client.phone
                        : ''}
                    </small>
                  </div>

                  <div className={'boarding-status boarding-status--' + passenger.boardingStatus.toLowerCase()}>
                    {passenger.boardingStatus === 'BOARDED' ? (
                      <UserCheck size={15} />
                    ) : passenger.boardingStatus === 'ABSENT' ? (
                      <UserX size={15} />
                    ) : (
                      <Clock3 size={15} />
                    )}
                    <span>{statusLabel[passenger.boardingStatus]}</span>
                    {passenger.boardedAt ? (
                      <small>
                        {new Intl.DateTimeFormat('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(passenger.boardedAt))}
                      </small>
                    ) : null}
                  </div>

                  <div className="boarding-actions">
                    <button
                      type="button"
                      className="board"
                      disabled={!data?.canUpdate || saving || savingBulk}
                      onClick={() => void updateStatus(passenger.id, 'BOARDED')}
                    >
                      <Check size={14} />
                      Embarcou
                    </button>
                    <button
                      type="button"
                      className="absent"
                      disabled={!data?.canUpdate || saving || savingBulk}
                      onClick={() => void updateStatus(passenger.id, 'ABSENT')}
                    >
                      <UserX size={14} />
                      Ausente
                    </button>
                    {passenger.boardingStatus !== 'PENDING' ? (
                      <button
                        type="button"
                        className="pending"
                        disabled={!data?.canUpdate || saving || savingBulk}
                        onClick={() => void updateStatus(passenger.id, 'PENDING')}
                      >
                        <Clock3 size={14} />
                        Aguardando
                      </button>
                    ) : null}
                  </div>
                </article>
              )
            })
          ) : (
            <p className="admin-empty">
              Nenhum passageiro encontrado para este filtro.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
