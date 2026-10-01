import { Armchair, Bus, Lock, Unlock, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  adminApi,
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

  async function toggleSeat(seatNumber: number) {
    if (!data || savingSeat !== null) return

    setSelectedSeat(seatNumber)
    if (occupied.has(seatNumber)) return

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
                              onClick={() => void toggleSeat(seat)}
                              disabled={savingSeat === seat}
                              aria-label={
                                isOccupied
                                  ? 'Assento ' + seat + ', ocupado. Ver passageiro.'
                                  : isBlocked
                                    ? 'Assento ' + seat + ', bloqueado. Clique para liberar.'
                                    : 'Assento ' + seat + ', disponível. Clique para bloquear.'
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
                <span><i className="seat-legend-swatch available" />Disponível: clique para bloquear</span>
                <span><i className="seat-legend-swatch occupied" />Ocupado: clique para identificar</span>
                <span><i className="seat-legend-swatch blocked" />Bloqueado: clique para liberar</span>
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
                    <strong>{assignment.reservation.client.fullName}</strong>
                    <p>
                      Reserva #{assignment.reservation.id.slice(-8).toUpperCase()}
                      {' · '}
                      {assignment.reservation.status}
                    </p>
                    <small>{assignment.reservation.client.email || 'Sem e-mail'}</small>
                    <small>{assignment.reservation.client.phone || 'Sem telefone'}</small>
                  </>
                ) : blocked.has(selectedSeat) ? (
                  <>
                    <span className="admin-seat-detail-kicker">Assento {selectedSeat}</span>
                    <strong>Bloqueado pela agência</strong>
                    <p>Este lugar não pode ser comprado nem reservado enquanto estiver bloqueado.</p>
                    <button type="button" onClick={() => void toggleSeat(selectedSeat)}>
                      <Unlock size={15} />
                      Liberar assento
                    </button>
                  </>
                ) : (
                  <>
                    <span className="admin-seat-detail-kicker">Assento {selectedSeat}</span>
                    <strong>Disponível para venda</strong>
                    <p>O lugar está livre e pode ser escolhido pelo viajante.</p>
                    <button type="button" onClick={() => void toggleSeat(selectedSeat)}>
                      <Lock size={15} />
                      Bloquear assento
                    </button>
                  </>
                )}
              </div>
            </aside>
          </div>
        ) : null}
      </section>
    </div>
  )
}
