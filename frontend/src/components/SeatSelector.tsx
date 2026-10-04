import { Armchair, Bus, Check, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { VehicleFeature } from '../lib/publicApi'

type SeatLayout = 'TWO_BY_TWO' | 'TWO_BY_ONE'

type SeatSelectorProps = {
  origin: string
  destination: string
  capacity: number
  busLabel?: string | null
  seatLayout: SeatLayout
  deckCount: 1 | 2
  lowerDeckCapacity: number | null
  vehicleFeatures: VehicleFeature[]
  blockedSeats: number[]
  occupiedSeats: number[]
  passengerCount: number
  selectedSeats: number[]
  onConfirm: (seats: number[]) => void
  onClose: () => void
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
    <div
      className="seat-feature-zone"
      aria-label={'Instalações na ' + position.toLowerCase()}
    >
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

export function SeatSelector({
  origin,
  destination,
  capacity,
  busLabel,
  seatLayout,
  deckCount,
  lowerDeckCapacity,
  vehicleFeatures,
  blockedSeats,
  occupiedSeats,
  passengerCount,
  selectedSeats,
  onConfirm,
  onClose,
}: SeatSelectorProps) {
  const occupied = useMemo(() => new Set(occupiedSeats), [occupiedSeats])
  const blocked = useMemo(() => new Set(blockedSeats), [blockedSeats])
  const [activeDeck, setActiveDeck] = useState<1 | 2>(1)
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [draft, setDraft] = useState<number[]>(
    selectedSeats
      .filter((seat) => !occupied.has(seat) && !blocked.has(seat))
      .slice(0, passengerCount),
  )
  const validDraft = [...new Set(draft)]
    .filter((seat) => Number.isInteger(seat) && seat >= 1 && seat <= capacity &&
      !occupied.has(seat) && !blocked.has(seat))
    .slice(0, passengerCount)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLElement>('button:not([disabled])')?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const buttons = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
      )).filter((element) => element.getClientRects().length > 0)
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (!first || !last) {
        event.preventDefault()
        dialog.focus()
      } else if (!buttons.includes(document.activeElement as HTMLElement)) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

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
    if (occupied.has(seat) || blocked.has(seat)) return

    setDraft((current) => {
      const available = [...new Set(current)].filter((item) =>
        Number.isInteger(item) && item >= 1 && item <= capacity &&
        !occupied.has(item) && !blocked.has(item),
      ).slice(0, passengerCount)
      if (available.includes(seat)) {
        return available.filter((item) => item !== seat)
      }

      if (available.length >= passengerCount) return available
      return [...available, seat].sort((a, b) => a - b)
    })
  }

  const complete = passengerCount > 0 && validDraft.length === passengerCount
  const layoutLabel = seatLayout === 'TWO_BY_ONE' ? 'Disposição 2+1' : 'Disposição 2+2'

  return (
    <div className="seat-selector-overlay" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="seat-selector-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="seat-selector-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="seat-selector-header">
          <div>
            <span>Indo para</span>
            <h2 id="seat-selector-title">{destination}</h2>
            <small>{origin} → {destination}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar escolha de assentos">
            <X size={24} />
          </button>
        </header>

        <div className="seat-selector-scroll">
          <div className="seat-bus">
            <div className="seat-bus-front" aria-hidden="true">
              <Bus size={34} />
              <strong>{busLabel || 'Veículo da viagem'}</strong>
              <span>
                {layoutLabel} · {capacity} lugares
                {deckCount === 2 ? ' · 2 andares' : ''}
              </span>
            </div>

            {deckCount === 2 ? (
              <div className="seat-deck-tabs" role="group" aria-label="Andares do ônibus">
                <button
                  type="button"
                  aria-pressed={activeDeck === 1}
                  className={activeDeck === 1 ? 'active' : ''}
                  onClick={() => setActiveDeck(1)}
                >
                  Piso inferior
                  <small>{lowerCapacity} lugares</small>
                </button>
                <button
                  type="button"
                  aria-pressed={activeDeck === 2}
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
                <Fragment key={'row-' + activeDeck + '-' + rowIndex}>
                  {rowIndex === middleRow ? (
                    <FeatureZone features={deckFeatures} position="MIDDLE" />
                  ) : null}

                  <div
                    className={
                      'seat-row ' +
                      (seatLayout === 'TWO_BY_ONE'
                        ? 'seat-row--two-by-one'
                        : 'seat-row--two-by-two')
                    }
                  >
                    {row.map((seat, columnIndex) => {
                      if (seat === null) {
                        return (
                          <span
                            className={columnIndex === 2 ? 'seat-aisle' : 'seat-placeholder'}
                            key={'placeholder-' + rowIndex + '-' + columnIndex}
                            aria-hidden="true"
                          />
                        )
                      }

                      const isBlocked = blocked.has(seat)
                      const isOccupied = occupied.has(seat)
                      const isSelected = validDraft.includes(seat)
                      const state = isBlocked
                        ? 'blocked'
                        : isOccupied
                          ? 'occupied'
                          : isSelected
                            ? 'selected'
                            : 'available'

                      return (
                        <button
                          type="button"
                          key={seat}
                          className={'seat-item seat-item--' + state}
                          onClick={() => toggleSeat(seat)}
                          disabled={isOccupied || isBlocked}
                          aria-pressed={isSelected}
                          aria-label={
                            isBlocked
                              ? 'Assento ' + seat + ', bloqueado pela agência'
                              : isOccupied
                                ? 'Assento ' + seat + ', ocupado'
                                : isSelected
                                  ? 'Assento ' + seat + ', selecionado'
                                  : 'Assento ' + seat + ', disponível'
                          }
                        >
                          <Armchair size={22} aria-hidden="true" />
                          <strong>{seat}</strong>
                          {isSelected ? <Check size={13} aria-hidden="true" /> : null}
                          {isBlocked ? <i className="seat-blocked-mark" aria-hidden="true">×</i> : null}
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

        <div className="seat-selector-legend" aria-label="Legenda dos assentos">
          <span><i className="seat-legend-swatch available" />Disponível</span>
          <span><i className="seat-legend-swatch occupied" />Ocupado</span>
          <span><i className="seat-legend-swatch blocked" />Bloqueado</span>
          <span><i className="seat-legend-swatch selected" />Selecionado</span>
        </div>

        <footer className="seat-selector-footer">
          <div className="seat-selector-count" role="status" aria-live="polite" aria-atomic="true">
            <strong>{validDraft.length} de {passengerCount}</strong>
            <span>{passengerCount === 1 ? 'assento' : 'assentos'}</span>
          </div>

          <div className="seat-selector-fee">
            <span>Taxa de seleção</span>
            <strong>R$ 0,00</strong>
          </div>

          <button
            type="button"
            className="seat-selector-confirm"
            disabled={!complete}
            onClick={() => {
              onConfirm(validDraft)
              onClose()
            }}
          >
            Confirmar
          </button>
        </footer>
      </section>
    </div>
  )
}
