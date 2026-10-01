import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  MapPin,
  Plane,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Brand } from '../../components/Brand'
import { SeatSelector } from '../../components/SeatSelector'
import {
  fetchPublicPaymentConfig,
  fetchPublicTrip,
  fetchPublicTripSeats,
  requestReservation,
  type PublicPaymentConfig,
  type PublicSeatMap,
  type PublicTrip,
  type PurchasePaymentMethod,
  type ReservationRequestResult,
} from '../../lib/publicApi'

type TripDetailsPageProps = {
  tripId: string
  defaultPassengers: number
  onBack: () => void
  onClientAccess: () => void
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const date = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
})

export function TripDetailsPage({
  tripId,
  defaultPassengers,
  onBack,
  onClientAccess,
}: TripDetailsPageProps) {
  const [trip, setTrip] = useState<PublicTrip | null>(null)
  const [error, setError] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [passengerCount, setPassengerCount] = useState(defaultPassengers)
  const [companionNames, setCompanionNames] = useState<string[]>(
    Array.from({ length: Math.max(0, defaultPassengers - 1) }, () => ''),
  )
  const [submitting, setSubmitting] = useState(false)
  const [requestResult, setRequestResult] = useState<ReservationRequestResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [seatMap, setSeatMap] = useState<PublicSeatMap | null>(null)
  const [seatMapLoading, setSeatMapLoading] = useState(true)
  const [seatSelectorOpen, setSeatSelectorOpen] = useState(false)
  const [selectedSeats, setSelectedSeats] = useState<number[]>([])
  const [flowMode, setFlowMode] = useState<'PURCHASE' | 'RESERVATION'>('RESERVATION')
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('PIX')
  const [paymentConfig, setPaymentConfig] = useState<PublicPaymentConfig | null>(null)
  const [pixCopied, setPixCopied] = useState(false)

  useEffect(() => {
    let active = true

    void fetchPublicTrip(tripId)
      .then((result) => {
        if (!active) return
        setTrip(result)
        window.scrollTo({ top: 0, behavior: 'auto' })
        document.title = `${result.destination} | Próximo Destino`
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Viagem indisponível.')
      })

    void fetchPublicPaymentConfig()
      .then((result) => {
        if (active) setPaymentConfig(result)
      })
      .catch(() => {
        if (active) setPaymentConfig(null)
      })

    void fetchPublicTripSeats(tripId)
      .then((result) => {
        if (!active) return
        setSeatMap(result)
        setSelectedSeats((current) =>
          current.filter(
          (seat) =>
            !result.occupiedSeats.includes(seat) &&
            !result.blockedSeats.includes(seat),
        ),
        )
      })
      .catch(() => {
        if (active) setSeatMap(null)
      })
      .finally(() => {
        if (active) setSeatMapLoading(false)
      })

    return () => {
      active = false
      document.title = 'Próximo Destino'
    }
  }, [tripId])

  useEffect(() => {
    if (
      trip?.priceCents &&
      trip.priceCents > 0 &&
      paymentConfig?.configured
    ) {
      setFlowMode('PURCHASE')
      return
    }

    setFlowMode('RESERVATION')
  }, [trip, paymentConfig])

  async function refreshSeatMap(showError = false) {
    setSeatMapLoading(true)

    try {
      const result = await fetchPublicTripSeats(tripId)
      setSeatMap(result)
      setSelectedSeats((current) =>
        current.filter(
          (seat) =>
            !result.occupiedSeats.includes(seat) &&
            !result.blockedSeats.includes(seat),
        ),
      )
      return result
    } catch (cause) {
      if (showError) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Não foi possível atualizar os assentos disponíveis.',
        )
      }
      return null
    } finally {
      setSeatMapLoading(false)
    }
  }

  async function openSeatSelector() {
    setError('')
    const latest = await refreshSeatMap(true)
    if (latest?.enabled) setSeatSelectorOpen(true)
  }

  function changePassengerCount(value: number) {
    if (value === passengerCount) return
    setPassengerCount(value)
    setCompanionNames((current) =>
      Array.from(
        { length: Math.max(0, value - 1) },
        (_, index) => current[index] ?? '',
      ),
    )
    setSelectedSeats([])
  }

  function changeCompanionName(index: number, value: string) {
    setCompanionNames((current) =>
      current.map((name, currentIndex) =>
        currentIndex === index ? value : name,
      ),
    )
  }

  async function copyAccessCode() {
    if (!requestResult) return

    try {
      await navigator.clipboard.writeText(requestResult.accessCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  async function copyPixCode() {
    const payment = requestResult?.payment
    if (!payment || payment.kind !== 'PIX') return

    try {
      await navigator.clipboard.writeText(payment.qrCode)
      setPixCopied(true)
      window.setTimeout(() => setPixCopied(false), 1800)
    } catch {
      setPixCopied(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trip) return

    const seatSelectionExpected =
      trip.capacity !== null &&
      trip.capacity >= 1 &&
      trip.capacity <= 80

    if (seatSelectionExpected && !seatMap) {
      setError('Atualize a disponibilidade dos assentos antes de enviar a solicitação.')
      return
    }

    if (seatMap?.enabled && selectedSeats.length !== passengerCount) {
      setError(
        `Selecione ${passengerCount} ${passengerCount === 1 ? 'assento' : 'assentos'} antes de continuar.`,
      )
      setSeatSelectorOpen(true)
      return
    }

    const incompleteCompanion = companionNames.findIndex(
      (name) => name.trim().length < 2,
    )
    if (incompleteCompanion >= 0) {
      setError(`Informe o nome completo do passageiro ${incompleteCompanion + 2}.`)
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const result = await requestReservation({
        tripId: trip.id,
        fullName,
        email,
        phone,
        passengerCount,
        passengers: [
          { fullName: fullName.trim() },
          ...companionNames.map((name) => ({ fullName: name.trim() })),
        ],
        selectedSeats: seatMap?.enabled ? selectedSeats : undefined,
        intent: flowMode,
        paymentMethod: flowMode === 'PURCHASE' ? paymentMethod : undefined,
      })
      setRequestResult(result)
      setSeatSelectorOpen(false)
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : 'Não foi possível registrar sua solicitação.'

      setError(message)

      if (message.toLowerCase().includes('assento')) {
        await refreshSeatMap(false)
        setSeatSelectorOpen(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (error && !trip) {
    return (
      <main className="trip-details-shell">
        <button className="trip-details-back" type="button" onClick={onBack}><ArrowLeft size={16} /> Voltar</button>
        <div className="empty-trips"><h3>Viagem indisponível</h3><p>{error}</p></div>
      </main>
    )
  }

  if (!trip) {
    return (
      <div className="trip-details-loading" role="status" aria-live="polite">
        <span className="trip-details-loading-mark" aria-hidden="true" />
        <strong>Carregando sua viagem</strong>
        <span>Consultando as informações publicadas pela agência.</span>
      </div>
    )
  }

  const nights = trip.returnDate
    ? Math.max(
        0,
        Math.round(
          (new Date(trip.returnDate).getTime() - new Date(trip.departureDate).getTime()) /
          86_400_000,
        ),
      )
    : null

  const seatSelectionExpected =
    trip.capacity !== null &&
    trip.capacity >= 1 &&
    trip.capacity <= 80
  const hasPublishedPrice =
    trip.priceCents !== null &&
    trip.priceCents > 0
  const purchaseAvailable =
    hasPublishedPrice &&
    paymentConfig?.configured === true
  const totalCents = hasPublishedPrice
    ? trip.priceCents! * passengerCount
    : null

  return (
    <div className="trip-details-page">
      <header className="public-header">
        <button className="public-brand-button" type="button" onClick={onBack} aria-label="Próximo Destino">
          <Brand compact />
        </button>
        <button className="trip-details-back" type="button" onClick={onBack}>
          <ArrowLeft size={16} /> Voltar às viagens
        </button>
        <button className="public-client-access" type="button" onClick={onClientAccess}>Minha viagem</button>
      </header>

      <main className="trip-details-shell">
        <section
          className="trip-details-hero"
          style={trip.imageUrl ? { backgroundImage: `linear-gradient(90deg, rgba(10,35,56,.82), rgba(10,35,56,.28)), url("${trip.imageUrl}")` } : undefined}
        >
          <div>
            <span className="public-kicker">{trip.status === 'ACTIVE' ? 'Disponível agora' : 'Viagem programada'}</span>
            <h1>{trip.title}</h1>
            <p>{trip.summary || 'Solicite sua reserva e a agência confirma os serviços e condições.'}</p>
          </div>
        </section>

        <section className="trip-details-grid">
          <article className="trip-details-info">
            <div className="trip-route-large">
              <div><small>Origem</small><strong>{trip.origin}</strong></div>
              <Plane size={22} />
              <div><small>Destino</small><strong>{trip.destination}</strong></div>
            </div>

            <div className="trip-detail-facts">
              <span><CalendarDays size={16} /><strong>Ida</strong>{date.format(new Date(trip.departureDate))}</span>
              <span><CalendarDays size={16} /><strong>Retorno</strong>{trip.returnDate ? date.format(new Date(trip.returnDate)) : 'A confirmar'}</span>
              <span><Users size={16} /><strong>Duração</strong>{nights == null ? 'A confirmar' : `${nights} noites`}</span>
              <span><MapPin size={16} /><strong>Capacidade</strong>{trip.capacity == null ? 'Sob consulta' : `Até ${trip.capacity} viajantes`}</span>
            </div>

            <div className="trip-details-price">
              <span>A partir de</span>
              <strong>{trip.priceCents == null ? 'Sob consulta' : money.format(trip.priceCents / 100)}</strong>
              <small>por pessoa. Serviços e condições finais são confirmados pela agência.</small>
            </div>

            <div className="availability-note">
              <ShieldCheck size={17} />
              <div>
                <strong>
                  {purchaseAvailable
                    ? 'Pagamento online protegido'
                    : hasPublishedPrice
                      ? 'Compra online em configuração'
                      : 'Solicitação sem cobrança automática'}
                </strong>
                <span>
                  {purchaseAvailable
                    ? 'PIX e cartão são processados pelo ambiente seguro do Mercado Pago.'
                    : hasPublishedPrice
                      ? 'A reserva continua disponível enquanto o pagamento online é ativado pela agência.'
                      : 'O envio abaixo registra interesse. A reserva permanece pendente até confirmação da agência.'}
                </span>
              </div>
            </div>
          </article>

          <aside className="trip-reservation-card">
            {requestResult ? (
              <div className="reservation-success">
                <CheckCircle2 size={30} />
                <span className="eyebrow">
                  {requestResult.purchaseOrder ? 'Compra registrada' : 'Solicitação registrada'}
                </span>
                <h2>
                  {requestResult.purchaseOrder
                    ? 'Pedido aguardando pagamento'
                    : 'Guarde seu código de acesso'}
                </h2>
                {requestResult.selectedSeats.length ? (
                  <div className="reservation-selected-seats">
                    <span>Assentos</span>
                    <strong>{requestResult.selectedSeats.join(', ')}</strong>
                  </div>
                ) : null}

                {requestResult.passengers.length > 1 ? (
                  <div className="reservation-passenger-summary">
                    {requestResult.passengers.map((passenger) => (
                      <div key={passenger.id}>
                        <span>Passageiro {passenger.sequence}</span>
                        <strong>{passenger.fullName || 'Nome não informado'}</strong>
                        {passenger.seatAssignment ? (
                          <small>Assento {passenger.seatAssignment.seatNumber}</small>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {requestResult.purchaseOrder ? (
                  <div className="purchase-success-summary">
                    <div>
                      <span>Total do pedido</span>
                      <strong>{money.format(requestResult.purchaseOrder.totalCents / 100)}</strong>
                    </div>
                    <div>
                      <span>Pagamento</span>
                      <strong>
                        {{
                          PIX: 'PIX',
                          CARD: 'Cartão',
                          BOLETO: 'Boleto',
                          TRANSFER: 'Transferência',
                        }[requestResult.purchaseOrder.paymentMethod]}
                      </strong>
                    </div>
                    <small>
                      O pedido foi criado e está aguardando o processamento do pagamento.
                    </small>
                  </div>
                ) : null}
                {requestResult.payment?.kind === 'PIX' ? (
                  <div className="purchase-pix-box">
                    <div className="purchase-pix-heading">
                      <div>
                        <span>PIX gerado</span>
                        <strong>Escaneie ou copie o código</strong>
                      </div>
                      <small>Aguardando pagamento</small>
                    </div>

                    {requestResult.payment.qrCodeBase64 ? (
                      <img
                        className="purchase-pix-qr"
                        src={`data:image/png;base64,${requestResult.payment.qrCodeBase64}`}
                        alt="QR Code PIX para pagamento"
                      />
                    ) : null}

                    <div className="purchase-pix-copy">
                      <code>{requestResult.payment.qrCode}</code>
                      <button
                        type="button"
                        onClick={() => void copyPixCode()}
                        aria-label="Copiar código PIX"
                      >
                        {pixCopied ? <Check size={16} /> : <Copy size={16} />}
                        <span>{pixCopied ? 'Copiado' : 'Copiar PIX'}</span>
                      </button>
                    </div>

                    {requestResult.payment.ticketUrl ? (
                      <a
                        className="purchase-provider-link"
                        href={requestResult.payment.ticketUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir instruções do PIX
                      </a>
                    ) : null}
                  </div>
                ) : null}

                {requestResult.payment?.kind === 'CHECKOUT' ? (
                  <div className="purchase-checkout-box">
                    <span>Pagamento com cartão</span>
                    <strong>Conclua no ambiente seguro do Mercado Pago</strong>
                    <a
                      className="purchase-provider-link purchase-provider-link--primary"
                      href={requestResult.payment.checkoutUrl}
                    >
                      Continuar para o Mercado Pago
                    </a>
                  </div>
                ) : null}

                {requestResult.payment?.kind === 'UNAVAILABLE' ? (
                  <div className="purchase-payment-unavailable">
                    <strong>Pagamento temporariamente indisponível</strong>
                    <span>
                      Seu pedido foi preservado. Use “Minha viagem” para tentar novamente.
                    </span>
                  </div>
                ) : null}

                <div className="reservation-access-code">
                  <code>{requestResult.accessCode}</code>
                  <button
                    type="button"
                    className="reservation-copy-code"
                    onClick={() => void copyAccessCode()}
                    aria-label="Copiar código de acesso"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    <span>{copied ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                <p>Use este código junto com <strong>{email}</strong> em “Minha viagem”. Ele não será exibido novamente.</p>
                <button type="button" onClick={onClientAccess}>Acessar minha viagem</button>
              </div>
            ) : (
              <form onSubmit={submit}>
                {hasPublishedPrice ? (
                  <div className="purchase-mode-switch" role="tablist" aria-label="Forma de contratação">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={flowMode === 'PURCHASE'}
                      className={flowMode === 'PURCHASE' ? 'active' : ''}
                      onClick={() => {
                        if (purchaseAvailable) setFlowMode('PURCHASE')
                      }}
                      disabled={!purchaseAvailable}
                      title={
                        purchaseAvailable
                          ? 'Comprar online'
                          : 'Pagamento online em configuração'
                      }
                    >
                      Comprar
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={flowMode === 'RESERVATION'}
                      className={flowMode === 'RESERVATION' ? 'active' : ''}
                      onClick={() => setFlowMode('RESERVATION')}
                    >
                      Reservar
                    </button>
                  </div>
                ) : null}

                <span className="eyebrow">
                  {flowMode === 'PURCHASE' ? 'Compra da viagem' : 'Quero esta viagem'}
                </span>
                <h2>
                  {flowMode === 'PURCHASE' ? 'Comprar viagem' : 'Solicitar reserva'}
                </h2>
                <p>
                  {flowMode === 'PURCHASE'
                    ? 'Escolha os passageiros, assentos e a forma de pagamento para criar seu pedido.'
                    : 'A equipe recebe seus dados e confirma disponibilidade e condições.'}
                </p>

                <label>
                  Nome completo
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" placeholder="Seu nome completo" required />
                </label>
                <label>
                  E-mail
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="voce@exemplo.com" required />
                </label>
                <label>
                  WhatsApp
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="(85) 99999-9999" required />
                </label>
                <label>
                  Passageiros
                  <select value={passengerCount} onChange={(e) => changePassengerCount(Number(e.target.value))}>
                    {[1,2,3,4,5,6,7,8,9,10].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>

                {passengerCount > 1 ? (
                  <div className="public-passenger-fields">
                    <div className="public-passenger-fields-heading">
                      <strong>Quem vai viajar?</strong>
                      <span>Informe os nomes dos acompanhantes.</span>
                    </div>

                    <div className="public-passenger-primary">
                      <div>
                        <strong>Passageiro 1</strong>
                        <span>{fullName.trim() || 'Titular da reserva'}</span>
                      </div>
                      {selectedSeats[0] ? <small>Assento {selectedSeats[0]}</small> : null}
                    </div>

                    {companionNames.map((name, index) => (
                      <label className="public-passenger-row" key={index}>
                        <span>
                          Passageiro {index + 2}
                          {selectedSeats[index + 1] ? ` · Assento ${selectedSeats[index + 1]}` : ''}
                        </span>
                        <input
                          value={name}
                          onChange={(event) => changeCompanionName(index, event.target.value)}
                          autoComplete="off"
                          placeholder="Nome completo do acompanhante"
                          required
                        />
                      </label>
                    ))}
                  </div>
                ) : null}

                {seatSelectionExpected ? (
                  <div className="reservation-seat-field">
                    <div>
                      <span>Assentos</span>
                      <small>
                        {seatMapLoading
                          ? 'Atualizando disponibilidade...'
                          : seatMap
                            ? `${seatMap.busLabel ? `${seatMap.busLabel} · ` : ''}${seatMap.availableCount ?? 0} lugares disponíveis`
                            : 'Disponibilidade indisponível no momento'}
                      </small>
                    </div>
                    <button
                      type="button"
                      className={selectedSeats.length ? 'reservation-seat-picker selected' : 'reservation-seat-picker'}
                      onClick={() => void openSeatSelector()}
                      disabled={seatMapLoading}
                    >
                      {selectedSeats.length ? `Assentos ${selectedSeats.join(', ')}` : 'Escolher assentos'}
                    </button>
                  </div>
                ) : null}

                {flowMode === 'PURCHASE' && purchaseAvailable ? (
                  <>
                    <fieldset className="purchase-payment-methods">
                      <legend>Forma de pagamento</legend>
                      {([
                        ['PIX', 'PIX', 'QR Code e copia e cola'],
                        ['CARD', 'Cartão', 'Checkout seguro do Mercado Pago'],
                      ] as const).map(([value, label, description]) => (
                        <label
                          key={value}
                          className={paymentMethod === value ? 'active' : ''}
                        >
                          <input
                            type="radio"
                            name="payment-method"
                            value={value}
                            checked={paymentMethod === value}
                            onChange={() => setPaymentMethod(value)}
                          />
                          <span>
                            <strong>{label}</strong>
                            <small>{description}</small>
                          </span>
                        </label>
                      ))}
                    </fieldset>

                    <div className="purchase-total">
                      <div>
                        <span>{passengerCount} {passengerCount === 1 ? 'passageiro' : 'passageiros'}</span>
                        <small>
                          {money.format(trip.priceCents! / 100)} por pessoa
                        </small>
                      </div>
                      <strong>{money.format((totalCents ?? 0) / 100)}</strong>
                    </div>
                  </>
                ) : null}

                {error ? <p className="admin-login-error" role="alert">{error}</p> : null}

                <button
                  type="submit"
                  className={flowMode === 'PURCHASE' ? 'purchase-submit' : ''}
                  disabled={
                    submitting ||
                    (seatSelectionExpected && seatMapLoading) ||
                    (flowMode === 'PURCHASE' && !purchaseAvailable)
                  }
                >
                  {submitting
                    ? 'Registrando...'
                    : flowMode === 'PURCHASE' && totalCents !== null
                      ? `Comprar por ${money.format(totalCents / 100)}`
                      : 'Enviar solicitação'}
                </button>

                {flowMode === 'PURCHASE' ? (
                  <small className="purchase-payment-note">
                    PIX é gerado na própria página. No cartão, você continua no checkout seguro do Mercado Pago.
                  </small>
                ) : null}
              </form>
            )}
          </aside>
        </section>
      </main>

      {seatSelectorOpen && seatMap?.enabled && seatMap.capacity ? (
        <SeatSelector
          origin={trip.origin}
          destination={trip.destination}
          capacity={seatMap.capacity}
          busLabel={seatMap.busLabel}
          seatLayout={seatMap.seatLayout}
          deckCount={seatMap.deckCount}
          lowerDeckCapacity={seatMap.lowerDeckCapacity}
          vehicleFeatures={seatMap.vehicleFeatures}
          blockedSeats={seatMap.blockedSeats}
          occupiedSeats={seatMap.occupiedSeats}
          passengerCount={passengerCount}
          selectedSeats={selectedSeats}
          onConfirm={setSelectedSeats}
          onClose={() => setSeatSelectorOpen(false)}
        />
      ) : null}
    </div>
  )
}
