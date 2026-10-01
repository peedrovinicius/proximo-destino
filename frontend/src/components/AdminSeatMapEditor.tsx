import { Armchair, Lock, UserRound } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import type {
  AdminSeatOccupancy,
  SeatLayout,
  VehicleFeature,
} from '../lib/adminApi'

type AdminSeatMapEditorProps = {
  capacity: number
  seatLayout: SeatLayout
  deckCount: 1 | 2
  lowerDeckCapacity: number | null
  vehicleFeatures: VehicleFeature[]
  blockedSeats: number[]
  occupiedSeats?: AdminSeatOccupancy[]
  loading?: boolean
  onChange: (blockedSeats: number[]) => void
}

function buildRows(start: number, end: number, seatLayout: SeatLayout) {
  const size = seatLayout === 'TWO_BY_ONE' ? 3 : 4
  const count = Math.max(0, end - start + 1)

  return Array.from({ length: Math.ceil(count / size) }, (_, index) => {
    const base = start + index * size
    const values =
      seatLayout === 'TWO_BY_ONE'
        ? [base, base + 1, null, base + 2]
        : [base, base + 1, null, base + 3, base + 2]

    return values.map((seat) =>
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
    <div className="admin-seat-feature-zone">
      {(['LEFT', 'CENTER', 'RIGHT'] as const).map((side) => (
        <div
          className={'admin-seat-feature-side admin-seat-feature-side--' + side.toLowerCase()}
          key={side}
        >
          {items
            .filter((feature) => feature.side === side)
            .map((feature, index) => (
              <span
                className="admin-seat-feature"
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

export function AdminSeatMapEditor({
  capacity,
  seatLayout,
  deckCount,
  lowerDeckCapacity,
  vehicleFeatures,
  blockedSeats,
  occupiedSeats = [],
  loading = false,
  onChange,
}: AdminSeatMapEditorProps) {
  const [activeDeck, setActiveDeck] = useState<1 | 2>(1)
  const [selectedOccupied, setSelectedOccupied] =
    useState<AdminSeatOccupancy | null>(null)

  useEffect(() => {
    if (deckCount === 1) setActiveDeck(1)
  }, [deckCount])

  const occupiedMap = useMemo(
    () =>
      new Map(
        occupiedSeats.map((seat) => [seat.seatNumber, seat] as const),
      ),
    [occupiedSeats],
  )
  const blocked = useMemo(() => new Set(blockedSeats), [blockedSeats])

  const lowerCapacity =
    deckCount === 2 &&
    lowerDeckCapacity !== null &&
    lowerDeckCapacity > 0 &&
    lowerDeckCapacity < capacity
      ? lowerDeckCapacity
      : capacity

  const range =
    deckCount === 2 && activeDeck === 2
      ? { start: lowerCapacity + 1, end: capacity }
      : { start: 1, end: lowerCapacity }

  const rows = useMemo(
    () => buildRows(range.start, range.end, seatLayout),
    [range.start, range.end, seatLayout],
  )

  const deckFeatures = vehicleFeatures.filter(
    (feature) => feature.deck === activeDeck,
  )
  const middleRow = Math.max(0, Math.floor(rows.length / 2))

  function toggleSeat(seat: number) {
    const occupied = occupiedMap.get(seat)
    if (occupied) {
      setSelectedOccupied(occupied)
      return
    }

    const next = blocked.has(seat)
      ? blockedSeats.filter((item) => item !== seat)
      : [...blockedSeats, seat]

    onChange([...new Set(next)].sort((a, b) => a - b))
  }

  if (loading) {
    return (
      <div className="admin-seat-editor admin-seat-editor--loading" role="status">
        <span className="admin-seat-editor-spinner" aria-hidden="true" />
        <div>
          <strong>Carregando mapa de assentos</strong>
          <small>Consultando reservas ativas desta viagem.</small>
        </div>
      </div>
    )
  }

  return (
    <section className="admin-seat-editor">
      <div className="admin-seat-editor-heading">
        <div>
          <strong>Mapa de assentos</strong>
          <span>Clique em um lugar livre para bloquear ou liberar.</span>
        </div>
        <div className="admin-seat-editor-metrics">
          <span>{capacity} lugares</span>
          <span>{occupiedSeats.length} ocupados</span>
          <span>{blockedSeats.length} bloqueados</span>
        </div>
      </div>

      {deckCount === 2 ? (
        <div className="admin-seat-deck-tabs" role="tablist" aria-label="Andares do ônibus">
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

      <div className="admin-seat-bus">
        <div className="admin-seat-bus-front">
          <span>Frente do veículo</span>
        </div>

        <FeatureZone features={deckFeatures} position="FRONT" />

        <div className="admin-seat-layout">
          {rows.map((row, rowIndex) => (
            <Fragment key={'admin-row-' + activeDeck + '-' + rowIndex}>
              {rowIndex === middleRow ? (
                <FeatureZone features={deckFeatures} position="MIDDLE" />
              ) : null}

              <div
                className={
                  'admin-seat-row ' +
                  (seatLayout === 'TWO_BY_ONE'
                    ? 'admin-seat-row--two-by-one'
                    : 'admin-seat-row--two-by-two')
                }
              >
                {row.map((seat, columnIndex) => {
                  if (seat === null) {
                    return (
                      <span
                        className={
                          columnIndex === 2
                            ? 'admin-seat-aisle'
                            : 'admin-seat-placeholder'
                        }
                        key={'admin-placeholder-' + rowIndex + '-' + columnIndex}
                        aria-hidden="true"
                      />
                    )
                  }

                  const occupied = occupiedMap.get(seat)
                  const isBlocked = blocked.has(seat)
                  const state = occupied
                    ? 'occupied'
                    : isBlocked
                      ? 'blocked'
                      : 'available'

                  return (
                    <button
                      type="button"
                      className={'admin-seat-item admin-seat-item--' + state}
                      key={seat}
                      onClick={() => toggleSeat(seat)}
                      aria-label={
                        occupied
                          ? 'Assento ' + seat + ', ocupado por ' + occupied.client.fullName
                          : isBlocked
                            ? 'Assento ' + seat + ', bloqueado. Clique para liberar.'
                            : 'Assento ' + seat + ', livre. Clique para bloquear.'
                      }
                      title={
                        occupied
                          ? 'Ocupado por ' + occupied.client.fullName
                          : isBlocked
                            ? 'Bloqueado pela agência'
                            : 'Livre'
                      }
                    >
                      {occupied ? (
                        <UserRound size={16} aria-hidden="true" />
                      ) : isBlocked ? (
                        <Lock size={16} aria-hidden="true" />
                      ) : (
                        <Armchair size={16} aria-hidden="true" />
                      )}
                      <strong>{seat}</strong>
                    </button>
                  )
                })}
              </div>
            </Fragment>
          ))}
        </div>

        <FeatureZone features={deckFeatures} position="REAR" />
      </div>

      <div className="admin-seat-editor-legend" aria-label="Legenda">
        <span><i className="available" />Livre</span>
        <span><i className="blocked" />Bloqueado</span>
        <span><i className="occupied" />Ocupado</span>
      </div>

      {selectedOccupied ? (
        <div className="admin-seat-occupant-card" role="status">
          <div>
            <span>Assento {selectedOccupied.seatNumber}</span>
            <strong>{selectedOccupied.client.fullName}</strong>
          </div>
          <div>
            <span>{selectedOccupied.reservationStatus}</span>
            <small>
              {selectedOccupied.client.phone ||
                selectedOccupied.client.email ||
                'Contato não informado'}
            </small>
          </div>
          <button
            type="button"
            onClick={() => setSelectedOccupied(null)}
            aria-label="Fechar detalhe do passageiro"
          >
            Fechar
          </button>
        </div>
      ) : null}

      {occupiedSeats.length ? (
        <div className="admin-seat-occupied-list">
          <span>Ocupação atual</span>
          <div>
            {occupiedSeats.map((seat) => (
              <button
                type="button"
                key={seat.seatNumber}
                onClick={() => setSelectedOccupied(seat)}
              >
                <strong>{seat.seatNumber}</strong>
                <span>{seat.client.fullName}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
