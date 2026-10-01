import { Armchair, Bus, Lock, Search, Unlock, UserPlus, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  adminApi,
  type AdminClient,
  type AdminSeatMap,
  type SeatLayout,
  type VehicleFeature,
} from '../../lib/adminApi'

type AdminSeatMapProps = {
  accessToken: string
  tripId: string
  onClose: () => void
  onChanged: () => Promise<void>
}

function buildRows(start: number, end: number, seatLayout: SeatLayout) {
  const size = seatLayout === 'TWO_BY_ONE' ? 3 : 4
  const count = Math.max(0, end - start + 1)

  return Array.from({ length: Math.ceil(count / size) }, (_, index) => {
    const base = start + index * size
    const numbers =
      seatLayout === 'TWO_BY_ONE'
        ? [base, base + 1, null, base + 2]
        : [base, base + 1, null, base + 3, base + 2]

    return numbers.map((seat) =>
      seat !== null && seat <= end ? seat : null,
    )
  })
}

const featureLabels: Record<VehicleFeature['type'], string> = {
  RESTROOM: 'Banheiro',
  DOOR: 'Porta',
  STAIRS: 'Escada',
}

function FeatureZone({
  features,
  position,
}: {
  features: VehicleFeature[]
  position: VehicleFeature['position']
}) {
  const items = features.filter((feature) => feature.position === position)
  if (!items.length) return null

  return (
    <div className="seat-feature-zone">
      {(['LEFT', 'CENTER', 'RIGHT'] as const).map((side) => (
        <div
          className={'seat-feature-side seat-feature-side--' + side.toLowerCase()}
          key={side}
        >
          {items
            .filter((feature) => feature.side === side)
            .map((feature, index) => (
              <span
                className={'seat-feature seat-feature--' + feature.type.toLowerCase()}
                key={[
                  feature.type,
                  feature.deck,
                  feature.position,
                  feature.side,
                  index,
                ].join('-')}
              >
                {featureLabels[feature.type]}
              </span>
            ))}
        </div>
      ))}
    </div>
  )
}

export function AdminSeatMapDialog({
  accessToken,
  tripId,
  onClose,
  onChanged,
}: AdminSeatMapProps) {
  const [data, setData] = useState<AdminSeatMap | null>(null)
  const [activeDeck, setActiveDeck] = useState<1 | 2>(1)
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null)
  const [savingSeat, setSavingSeat] = useState<number | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignMode, setAssignMode] = useState<'existing' | 'new'>('existing')
  const [clientQuery, setClientQuery] = useState('')
  const [clients, setClients] = useState<AdminClient[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [newClientEmail, setNewClientEmail] = useState('')
  const [newClientPhone, setNewClientPhone] = useState('')
  const [newClientDocument, setNewClientDocument] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void adminApi.seatMap(accessToken, tripId)
      .then((result) => {
        if (active) setData(result)
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Falha ao carregar assentos.')
        }
      })

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      active = false
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [accessToken, onClose, tripId])

  useEffect(() => {
    if (!assignOpen || assignMode !== 'existing') return

    let active = true
    const timer = window.setTimeout(() => {
      setClientsLoading(true)
      void adminApi.clients(accessToken, clientQuery.trim())
        .then((result) => {
          if (active) setClients(result)
        })
        .catch((cause) => {
          if (active) {
            setError(
              cause instanceof Error
                ? cause.message
                : 'Falha ao buscar clientes.',
            )
          }
        })
        .finally(() => {
          if (active) setClientsLoading(false)
        })
    }, 220)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [accessToken, assignMode, assignOpen, clientQuery])

  const occupied = useMemo(
    () => new Set(data?.occupiedSeats ?? []),
    [data?.occupiedSeats],
  )
  const blocked = useMemo(
    () => new Set(data?.blockedSeats ?? []),
    [data?.blockedSeats],
  )
  const assignment = useMemo(
    () =>
      data?.assignments.find((item) => item.seatNumber === selectedSeat) ?? null,
    [data?.assignments, selectedSeat],
  )

  if (!data && !error) {
    return (
      <div className="admin-seat-manager-overlay" role="presentation">
        <section className="admin-seat-manager admin-seat-manager--loading">
          Carregando mapa de assentos...
        </section>
      </div>
    )
  }

  function selectSeat(seatNumber: number) {
    setSelectedSeat(seatNumber)
    setAssignOpen(false)
    setSelectedClientId('')
    setClientQuery('')
    setError('')
  }

  async function toggleSeatBlock(seatNumber: number) {
    if (!data || savingSeat !== null || occupied.has(seatNumber)) return

    setSavingSeat(seatNumber)
    setError('')
    try {
      const result = await adminApi.setSeatBlocked(
        accessToken,
        tripId,
        seatNumber,
        !blocked.has(seatNumber),
      )
      setData(result)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao alterar o assento.')
      try {
        setData(await adminApi.seatMap(accessToken, tripId))
      } catch {
        // mantém o último estado visível
      }
    } finally {
      setSavingSeat(null)
    }
  }

  async function assignClient() {
    if (selectedSeat === null || assigning) return

    if (assignMode === 'existing' && !selectedClientId) {
      setError('Selecione um cliente.')
      return
    }
    if (assignMode === 'new' && newClientName.trim().length < 2) {
      setError('Informe o nome completo do cliente.')
      return
    }

    setAssigning(true)
    setError('')

    try {
      const result = await adminApi.assignClientToSeat(
        accessToken,
        tripId,
        selectedSeat,
        assignMode === 'existing'
          ? { clientId: selectedClientId }
          : {
              fullName: newClientName.trim(),
              email: newClientEmail.trim() || undefined,
              phone: newClientPhone.trim() || undefined,
              document: newClientDocument.trim() || undefined,
            },
      )
      setData(result)
      setAssignOpen(false)
      setSelectedClientId('')
      setNewClientName('')
      setNewClientEmail('')
      setNewClientPhone('')
      setNewClientDocument('')
      await onChanged()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Falha ao cadastrar o cliente nesta poltrona.',
      )
      try {
        setData(await adminApi.seatMap(accessToken, tripId))
      } catch {
        // mantém o último estado visível
      }
    } finally {
      setAssigning(false)
    }
  }

  const capacity = data?.capacity ?? 0
  const lowerCapacity =
    data?.deckCount === 2 &&
    data.lowerDeckCapacity !== null &&
    data.lowerDeckCapacity > 0 &&
    data.lowerDeckCapacity < capacity
      ? data.lowerDeckCapacity
      : capacity

  const range =
    data?.deckCount === 2 && activeDeck === 2
      ? { start: lowerCapacity + 1, end: capacity }
      : { start: 1, end: lowerCapacity }

  const rows = data?.enabled
    ? buildRows(range.start, range.end, data.seatLayout)
    : []
  const deckFeatures =
    data?.vehicleFeatures.filter((feature) => feature.deck === activeDeck) ?? []
  const middleRow = Math.max(0, Math.floor(rows.length / 2))

  return (
    <div
      className="admin-seat-manager-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="admin-seat-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-seat-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-seat-manager-header">
          <div>
            <span>Gestão de assentos</span>
            <h2 id="admin-seat-manager-title">{data?.trip.title ?? 'Viagem'}</h2>
            {data ? (
              <small>
                {data.trip.origin} → {data.trip.destination}
              </small>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar mapa de assentos">
            <X size={22} />
          </button>
        </header>

        {error ? <div className="admin-seat-manager-error">{error}</div> : null}

        {data && !data.enabled ? (
          <div className="admin-seat-manager-empty">
            Esta viagem não possui mapa de assentos ativo.
          </div>
        ) : data ? (
          <div className="admin-seat-manager-body">
            <div className="admin-seat-manager-map">
              <div className="seat-bus">
                <div className="seat-bus-front" aria-hidden="true">
                  <Bus size={32} />
                  <strong>{data.busLabel || 'Veículo da viagem'}</strong>
                  <span>
                    {data.seatLayout === 'TWO_BY_ONE' ? 'Disposição 2+1' : 'Disposição 2+2'}
                    {' · '}
                    {data.capacity} lugares
                  </span>
                </div>

                {data.deckCount === 2 ? (
                  <div className="seat-deck-tabs" role="tablist" aria-label="Andares do ônibus">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeDeck === 1}
                      className={activeDeck === 1 ? 'active' : ''}
                      onClick={() => setActiveDeck(1)}
                    >
                      Piso inferior
                      <small>{lowerCapacity} lugares</small>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeDeck === 2}
                      className={activeDeck === 2 ? 'active' : ''}
                      onClick={() => setActiveDeck(2)}
                    >
                      Piso superior
                      <small>{capacity - lowerCapacity} lugares</small>
                    </button>
                  </div>
                ) : null}

                <div className="seat-layout">
                  <FeatureZone features={deckFeatures} position="FRONT" />

                  {rows.map((row, rowIndex) => (
                    <Fragment key={'admin-row-' + activeDeck + '-' + rowIndex}>
                      {rowIndex === middleRow ? (
                        <FeatureZone features={deckFeatures} position="MIDDLE" />
                      ) : null}

                      <div
                        className={
                          'seat-row ' +
                          (data.seatLayout === 'TWO_BY_ONE'
                            ? 'seat-row--two-by-one'
                            : 'seat-row--two-by-two')
                        }
                      >
                        {row.map((seat, columnIndex) => {
                          if (seat === null) {
                            return (
                              <span
                                className={columnIndex === 2 ? 'seat-aisle' : 'seat-placeholder'}
                                key={'admin-placeholder-' + rowIndex + '-' + columnIndex}
                                aria-hidden="true"
                              />
                            )
                          }

                          const isOccupied = occupied.has(seat)
                          const isBlocked = blocked.has(seat)
                          const isFocused = selectedSeat === seat
                          const state = isOccupied
                            ? 'occupied'
                            : isBlocked
                              ? 'blocked'
                              : 'available'

                          return (
                            <button
                              type="button"
                              key={seat}
                              className={
                                'seat-item seat-item--' +
                                state +
                                (isFocused ? ' admin-seat-item--focused' : '')
                              }
                              onClick={() => selectSeat(seat)}
                              disabled={savingSeat === seat}
                              aria-label={
                                isOccupied
                                  ? 'Assento ' + seat + ', ocupado. Ver passageiro.'
                                  : isBlocked
                                    ? 'Assento ' + seat + ', bloqueado. Clique para gerenciar.'
                                    : 'Assento ' + seat + ', disponível. Clique para gerenciar.'
                              }
                            >
                              <Armchair size={22} aria-hidden="true" />
                              <strong>{seat}</strong>
                              {isBlocked ? <Lock size={12} aria-hidden="true" /> : null}
                            </button>
                          )
                        })}
                      </div>
                    </Fragment>
                  ))}

                  <FeatureZone features={deckFeatures} position="REAR" />
                </div>
              </div>
            </div>

            <aside className="admin-seat-manager-side">
              <div className="admin-seat-manager-metrics">
                <span><strong>{data.availableCount ?? 0}</strong> disponíveis</span>
                <span><strong>{data.occupiedSeats.length}</strong> ocupados</span>
                <span><strong>{data.blockedSeats.length}</strong> bloqueados</span>
              </div>

              <div className="admin-seat-manager-legend">
                <span><i className="seat-legend-swatch available" />Disponível: cadastrar cliente ou bloquear</span>
                <span><i className="seat-legend-swatch occupied" />Ocupado: clique para identificar</span>
                <span><i className="seat-legend-swatch blocked" />Bloqueado: pode ser liberado ou usado pelo Admin</span>
              </div>

              <div className="admin-seat-detail">
                {selectedSeat === null ? (
                  <>
                    <strong>Selecione um assento</strong>
                    <p>Clique no mapa para bloquear, liberar ou ver quem ocupa o lugar.</p>
                  </>
                ) : assignment ? (
                  <>
                    <span className="admin-seat-detail-kicker">Assento {selectedSeat}</span>
                    <strong>
                      {assignment.passenger?.fullName || assignment.reservation.client.fullName}
                    </strong>
                    <p>
                      {assignment.passenger
                        ? 'Passageiro ' + assignment.passenger.sequence + ' · '
                        : ''}
                      Reserva #{assignment.reservation.id.slice(-8).toUpperCase()}
                      {' · '}
                      {assignment.reservation.status}
                    </p>
                    <small>
                      {assignment.passenger?.document
                        ? 'Documento: ' + assignment.passenger.document
                        : assignment.passenger
                          ? 'Documento não informado'
                          : 'Passageiro específico ainda não identificado'}
                    </small>
                    <small>{assignment.reservation.client.email || 'Sem e-mail'} · {assignment.reservation.client.phone || 'Sem telefone'}</small>
                    <span className={'admin-seat-source admin-seat-source--' + assignment.source.toLowerCase()}>
                      {assignment.source === 'ONLINE_PURCHASE'
                        ? 'Compra online · protegida'
                        : assignment.source === 'PUBLIC_RESERVATION'
                          ? 'Solicitação pelo site'
                          : 'Cadastro manual do Admin'}
                    </span>
                  </>
                ) : blocked.has(selectedSeat) ? (
                  <>
                    <span className="admin-seat-detail-kicker">Assento {selectedSeat}</span>
                    <strong>Bloqueado pela agência</strong>
                    <p>Este lugar não pode ser comprado pelo site enquanto estiver bloqueado. O Admin ainda pode cadastrar um cliente nele.</p>
                    <div className="admin-seat-detail-actions">
                      <button type="button" onClick={() => setAssignOpen(true)}>
                        <UserPlus size={15} />
                        Cadastrar cliente
                      </button>
                      <button type="button" className="secondary" onClick={() => void toggleSeatBlock(selectedSeat)}>
                        <Unlock size={15} />
                        Liberar assento
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="admin-seat-detail-kicker">Assento {selectedSeat}</span>
                    <strong>Poltrona disponível</strong>
                    <p>Cadastre um cliente diretamente nesta poltrona ou mantenha o lugar fora da venda pública.</p>
                    <div className="admin-seat-detail-actions">
                      <button type="button" onClick={() => setAssignOpen(true)}>
                        <UserPlus size={15} />
                        Cadastrar cliente
                      </button>
                      <button type="button" className="secondary" onClick={() => void toggleSeatBlock(selectedSeat)}>
                        <Lock size={15} />
                        Bloquear assento
                      </button>
                    </div>
                  </>
                )}
              </div>

              {assignOpen && selectedSeat !== null && !assignment ? (
                <div className="admin-seat-client-panel">
                  <div className="admin-seat-client-panel-head">
                    <div>
                      <span>Poltrona {selectedSeat}</span>
                      <strong>Cadastrar cliente</strong>
                    </div>
                    <button type="button" onClick={() => setAssignOpen(false)} aria-label="Fechar cadastro">
                      <X size={16} />
                    </button>
                  </div>

                  <div className="admin-seat-client-tabs">
                    <button
                      type="button"
                      className={assignMode === 'existing' ? 'active' : ''}
                      onClick={() => setAssignMode('existing')}
                    >
                      Cliente existente
                    </button>
                    <button
                      type="button"
                      className={assignMode === 'new' ? 'active' : ''}
                      onClick={() => setAssignMode('new')}
                    >
                      Novo cliente
                    </button>
                  </div>

                  {assignMode === 'existing' ? (
                    <>
                      <label className="admin-seat-client-search">
                        <Search size={15} />
                        <input
                          value={clientQuery}
                          onChange={(event) => setClientQuery(event.target.value)}
                          placeholder="Buscar por nome, e-mail ou telefone"
                        />
                      </label>

                      <div className="admin-seat-client-results">
                        {clientsLoading ? (
                          <span>Buscando clientes...</span>
                        ) : clients.length ? (
                          clients.slice(0, 8).map((client) => (
                            <button
                              type="button"
                              key={client.id}
                              className={selectedClientId === client.id ? 'active' : ''}
                              onClick={() => setSelectedClientId(client.id)}
                            >
                              <strong>{client.fullName}</strong>
                              <small>{client.email || client.phone || 'Sem contato informado'}</small>
                            </button>
                          ))
                        ) : (
                          <span>Nenhum cliente encontrado.</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="admin-seat-client-form">
                      <label>
                        <span>Nome completo</span>
                        <input
                          value={newClientName}
                          onChange={(event) => setNewClientName(event.target.value)}
                          placeholder="Nome do cliente"
                        />
                      </label>
                      <label>
                        <span>E-mail</span>
                        <input
                          type="email"
                          value={newClientEmail}
                          onChange={(event) => setNewClientEmail(event.target.value)}
                          placeholder="email@exemplo.com"
                        />
                      </label>
                      <label>
                        <span>Telefone</span>
                        <input
                          value={newClientPhone}
                          onChange={(event) => setNewClientPhone(event.target.value)}
                          placeholder="(85) 99999-9999"
                        />
                      </label>
                      <label>
                        <span>Documento</span>
                        <input
                          value={newClientDocument}
                          onChange={(event) => setNewClientDocument(event.target.value)}
                          placeholder="CPF ou documento"
                        />
                      </label>
                    </div>
                  )}

                  <button
                    type="button"
                    className="admin-seat-client-confirm"
                    disabled={
                      assigning ||
                      (assignMode === 'existing'
                        ? !selectedClientId
                        : newClientName.trim().length < 2)
                    }
                    onClick={() => void assignClient()}
                  >
                    <UserPlus size={15} />
                    {assigning ? 'Cadastrando...' : 'Confirmar nesta poltrona'}
                  </button>
                </div>
              ) : null}
            </aside>
          </div>
        ) : null}
      </section>
    </div>
  )
}
