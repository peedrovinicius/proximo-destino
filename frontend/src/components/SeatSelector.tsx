import { Armchair, Bus, Check, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type SeatLayout = 'TWO_BY_TWO' | 'TWO_BY_ONE'

type SeatSelectorProps = {
  origin: string
  destination: string
  capacity: number
  busLabel?: string | null
  seatLayout: SeatLayout
  occupiedSeats: number[]
  passengerCount: number
  selectedSeats: number[]
  onConfirm: (seats: number[]) => void
  onClose: () => void
}

export function SeatSelector({
  origin,
  destination,
  capacity,
  busLabel,
  seatLayout,
  occupiedSeats,
  passengerCount,
  selectedSeats,
  onConfirm,
  onClose,
}: SeatSelectorProps) {
  const occupied = useMemo(() => new Set(occupiedSeats), [occupiedSeats])
  const [draft, setDraft] = useState<number[]>(
    selectedSeats.filter((seat) => !occupied.has(seat)).slice(0, passengerCount),
  )

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const rows = useMemo(() => {
    if (seatLayout === 'TWO_BY_ONE') {
      return Array.from({ length: Math.ceil(capacity / 3) }, (_, index) => {
        const base = index * 3
        return [base + 1, base + 2, null, base + 3].map((seat) =>
          seat !== null && seat <= capacity ? seat : null,
        )
      })
    }

    return Array.from({ length: Math.ceil(capacity / 4) }, (_, index) => {
      const base = index * 4
      return [base + 1, base + 2, null, base + 4, base + 3].map((seat) =>
        seat !== null && seat <= capacity ? seat : null,
      )
    })
  }, [capacity, seatLayout])

  function toggleSeat(seat: number) {
    if (occupied.has(seat)) return

    setDraft((current) => {
      if (current.includes(seat)) {
        return current.filter((item) => item !== seat)
      }

      if (current.length >= passengerCount) return current
      return [...current, seat].sort((a, b) => a - b)
    })
  }

  const complete = draft.length === passengerCount
  const layoutLabel = seatLayout === 'TWO_BY_ONE' ? 'Disposição 2+1' : 'Disposição 2+2'

  return (
    <div className="seat-selector-overlay" role="presentation" onMouseDown={onClose}>
      <section
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
              <span>{layoutLabel} · {capacity} lugares</span>
            </div>

            <div className={`seat-grid ${seatLayout === 'TWO_BY_ONE' ? 'seat-grid--two-by-one' : 'seat-grid--two-by-two'}`}>
              {rows.flatMap((row, rowIndex) =>
                row.map((seat, columnIndex) => {
                  if (seat === null) {
                    return (
                      <span
                        className={columnIndex === 2 ? 'seat-aisle' : 'seat-placeholder'}
                        key={`placeholder-${rowIndex}-${columnIndex}`}
                        aria-hidden="true"
                      />
                    )
                  }

                  const isOccupied = occupied.has(seat)
                  const isSelected = draft.includes(seat)
                  const state = isOccupied
                    ? 'occupied'
                    : isSelected
                      ? 'selected'
                      : 'available'

                  return (
                    <button
                      type="button"
                      key={seat}
                      className={`seat-item seat-item--${state}`}
                      onClick={() => toggleSeat(seat)}
                      disabled={isOccupied}
                      aria-pressed={isSelected}
                      aria-label={
                        isOccupied
                          ? `Assento ${seat}, ocupado`
                          : isSelected
                            ? `Assento ${seat}, selecionado`
                            : `Assento ${seat}, disponível`
                      }
                    >
                      <Armchair size={22} aria-hidden="true" />
                      <strong>{seat}</strong>
                      {isSelected ? <Check size={13} aria-hidden="true" /> : null}
                    </button>
                  )
                }),
              )}
            </div>
          </div>
        </div>

        <div className="seat-selector-legend" aria-label="Legenda dos assentos">
          <span><i className="seat-legend-swatch available" />Disponível</span>
          <span><i className="seat-legend-swatch occupied" />Ocupado</span>
          <span><i className="seat-legend-swatch selected" />Selecionado</span>
        </div>

        <footer className="seat-selector-footer">
          <div className="seat-selector-count">
            <strong>{draft.length} de {passengerCount}</strong>
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
              onConfirm(draft)
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
