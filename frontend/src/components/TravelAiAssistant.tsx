import {
  Bot,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  askTravelAssistant,
  type AssistantMessage,
} from '../lib/publicApi'

const initialMessage: AssistantMessage = {
  role: 'assistant',
  content:
    'Olá! Posso ajudar você a encontrar uma viagem disponível na Próximo Destino. Me diga o que procura, por exemplo destino, orçamento ou estilo de viagem.',
}

const quickPrompts = [
  'Quais viagens estão disponíveis?',
  'Qual é a opção mais econômica?',
  'Quero uma viagem de praia.',
]

export function TravelAiAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AssistantMessage[]>([initialMessage])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [messages, open])

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy) return

    const previous = messages
    setMessages((current) => [
      ...current,
      { role: 'user', content: message },
    ])
    setDraft('')
    setBusy(true)
    setStatus('Consultando as viagens disponíveis...')

    try {
      const result = await askTravelAssistant(message, previous)
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: result.answer },
      ])
      setStatus('')
    } catch (cause) {
      void cause
            setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: 'Não consegui consultar o assistente agora. Você pode tentar novamente em instantes ou falar com a agência pelo WhatsApp.',
        },
      ])
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send(draft)
  }

  return (
    <div className={open ? 'ai-assistant ai-assistant--open' : 'ai-assistant'}>
      {open ? (
        <section
          className="ai-assistant-panel"
          role="dialog"
          aria-label="Assistente de viagens da Próximo Destino"
        >
          <header className="ai-assistant-header">
            <div className="ai-assistant-identity">
              <span className="ai-assistant-avatar" aria-hidden="true">
                <Sparkles size={17} />
              </span>
              <div>
                <strong>Assistente de viagens</strong>
                <span>Consulta as viagens publicadas</span>
              </div>
            </div>

            <button
              type="button"
              className="ai-assistant-close"
              onClick={() => setOpen(false)}
              aria-label="Fechar assistente"
            >
              <X size={17} />
            </button>
          </header>

          <div className="ai-assistant-messages" aria-live="polite">
            {messages.map((message, index) => (
              <div
                className={
                  message.role === 'user'
                    ? 'ai-message ai-message--user'
                    : 'ai-message ai-message--assistant'
                }
                key={`${message.role}-${index}`}
              >
                {message.role === 'assistant' ? (
                  <span className="ai-message-icon" aria-hidden="true">
                    <Bot size={14} />
                  </span>
                ) : null}
                <p>{message.content}</p>
              </div>
            ))}

            {busy ? (
              <div className="ai-message ai-message--assistant ai-message--typing">
                <span className="ai-message-icon" aria-hidden="true">
                  <Bot size={14} />
                </span>
                <div className="ai-typing-dots" aria-label="Assistente respondendo">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          {messages.length <= 1 ? (
            <div className="ai-assistant-prompts">
              {quickPrompts.map((prompt) => (
                <button
                  type="button"
                  key={prompt}
                  onClick={() => void send(prompt)}
                  disabled={busy}
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}

          <form className="ai-assistant-form" onSubmit={submit}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Pergunte sobre destinos e viagens"
              maxLength={800}
              aria-label="Mensagem para o assistente"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Enviar mensagem"
            >
              <Send size={16} />
            </button>
          </form>

          <footer className="ai-assistant-note">
            <span>{status || 'Não envie documentos, senhas ou dados de pagamento.'}</span>
          </footer>
        </section>
      ) : null}

      <button
        type="button"
        className="ai-assistant-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? 'Fechar assistente de IA' : 'Abrir assistente de IA'}
      >
        <Sparkles size={19} />
        <span>Assistente de viagens</span>
      </button>
    </div>
  )
}
