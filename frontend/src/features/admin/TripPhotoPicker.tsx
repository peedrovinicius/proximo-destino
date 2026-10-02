import {
  Camera,
  ImagePlus,
  Link2,
  LoaderCircle,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  adminApi,
  type TripImageSuggestion,
} from '../../lib/adminApi'

type Props = {
  accessToken: string
  destination: string
  value: string
  previewUrl?: string | null
  busy?: boolean
  onChooseUrl: (url: string) => void
  onPreparedFile: (
    blob: Blob,
    filename: string,
    previewUrl: string,
  ) => Promise<void> | void
  onClear: () => Promise<void> | void
}

async function loadImage(file: File) {
  const source = URL.createObjectURL(file)

  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = source

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Não foi possível abrir esta imagem.'))
    })

    return {
      image,
      revoke: () => URL.revokeObjectURL(source),
    }
  } catch (error) {
    URL.revokeObjectURL(source)
    throw error
  }
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: 'image/webp' | 'image/jpeg',
  quality: number,
) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })
}

async function prepareImage(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem.')
  }

  const { image, revoke } = await loadImage(file)

  try {
    const longest = Math.max(image.naturalWidth, image.naturalHeight)
    const scale = longest > 1800 ? 1800 / longest : 1
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Não foi possível preparar a foto.')

    context.drawImage(image, 0, 0, width, height)

    let blob = await canvasBlob(canvas, 'image/webp', 0.84)
    let extension = 'webp'

    if (!blob) {
      blob = await canvasBlob(canvas, 'image/jpeg', 0.84)
      extension = 'jpg'
    }

    if (!blob) throw new Error('Não foi possível processar a foto.')

    if (blob.size > 2_400_000) {
      blob =
        (await canvasBlob(canvas, 'image/webp', 0.7)) ??
        (await canvasBlob(canvas, 'image/jpeg', 0.72))
    }

    if (!blob || blob.size > 2_500_000) {
      throw new Error('A foto ficou muito grande. Escolha uma imagem menor.')
    }

    const stem =
      file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'viagem'

    return {
      blob,
      filename: stem + '.' + extension,
      previewUrl: URL.createObjectURL(blob),
    }
  } finally {
    revoke()
  }
}

export function TripPhotoPicker({
  accessToken,
  destination,
  value,
  previewUrl,
  busy = false,
  onChooseUrl,
  onPreparedFile,
  onClear,
}: Props) {
  const uploadRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'actions' | 'url' | 'suggestions'>('actions')
  const [query, setQuery] = useState(destination)
  const [suggestions, setSuggestions] = useState<TripImageSuggestion[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setQuery(destination)
  }, [destination])

  const visiblePreview = useMemo(
    () => value.trim() || previewUrl || '',
    [previewUrl, value],
  )

  async function handleFile(file: File | undefined) {
    if (!file || busy || processing) return

    setProcessing(true)
    setError('')

    try {
      const prepared = await prepareImage(file)
      try {
        await onPreparedFile(
          prepared.blob,
          prepared.filename,
          prepared.previewUrl,
        )
      } catch (cause) {
        URL.revokeObjectURL(prepared.previewUrl)
        throw cause
      }
      setMode('actions')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível preparar esta foto.',
      )
    } finally {
      setProcessing(false)
      if (uploadRef.current) uploadRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
    }
  }

  async function searchSuggestions() {
    const normalized = query.trim()
    if (normalized.length < 2 || suggestionsLoading) return

    setSuggestionsLoading(true)
    setError('')

    try {
      setSuggestions(
        await adminApi.imageSuggestions(accessToken, normalized),
      )
    } catch (cause) {
      setSuggestions([])
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível buscar sugestões agora.',
      )
    } finally {
      setSuggestionsLoading(false)
    }
  }

  function chooseSuggestion(suggestion: TripImageSuggestion) {
    onChooseUrl(suggestion.imageUrl)
    setMode('actions')
  }

  return (
    <div className="trip-photo-picker">
      <div
        className={
          'trip-photo-picker-preview' +
          (visiblePreview ? '' : ' is-empty')
        }
        style={
          visiblePreview
            ? { backgroundImage: `url("${visiblePreview}")` }
            : undefined
        }
      >
        {!visiblePreview ? (
          <div>
            <ImagePlus size={22} />
            <strong>Escolha a foto da viagem</strong>
            <span>Nenhuma imagem será escolhida automaticamente.</span>
          </div>
        ) : (
          <span className="trip-photo-picker-selected">Foto selecionada</span>
        )}
      </div>

      <div className="trip-photo-picker-actions">
        <button
          type="button"
          disabled={busy || processing}
          onClick={() => uploadRef.current?.click()}
        >
          <Upload size={15} />
          Carregar foto
        </button>
        <button
          type="button"
          disabled={busy || processing}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera size={15} />
          Tirar foto
        </button>
        <button
          type="button"
          disabled={busy || processing}
          className={mode === 'url' ? 'active' : ''}
          onClick={() => setMode(mode === 'url' ? 'actions' : 'url')}
        >
          <Link2 size={15} />
          Usar link
        </button>
        <button
          type="button"
          disabled={busy || processing}
          className={mode === 'suggestions' ? 'active' : ''}
          onClick={() => {
            setMode('suggestions')
            if (!suggestions.length) void searchSuggestions()
          }}
        >
          <Sparkles size={15} />
          Sugestões
        </button>
        {visiblePreview ? (
          <button
            type="button"
            className="danger"
            disabled={busy || processing}
            onClick={() => void onClear()}
          >
            <Trash2 size={15} />
            Remover
          </button>
        ) : null}
      </div>

      <input
        ref={uploadRef}
        className="trip-photo-picker-file"
        type="file"
        accept="image/*"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <input
        ref={cameraRef}
        className="trip-photo-picker-file"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      {processing ? (
        <div className="trip-photo-picker-processing">
          <LoaderCircle size={15} className="spin" />
          <span>Otimizando foto para o site...</span>
        </div>
      ) : null}

      {mode === 'url' ? (
        <label className="trip-photo-picker-url">
          <span>Link direto da imagem</span>
          <input
            type="url"
            value={value}
            placeholder="https://.../foto.jpg"
            onChange={(event) => onChooseUrl(event.target.value)}
          />
          <small>
            Você continua podendo usar uma imagem hospedada em outro serviço.
          </small>
        </label>
      ) : null}

      {mode === 'suggestions' ? (
        <div className="trip-photo-suggestions">
          <div className="trip-photo-suggestions-search">
            <label>
              <Search size={14} />
              <input
                value={query}
                placeholder="Ex.: Jericoacoara, Gramado, Recife"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void searchSuggestions()
                  }
                }}
              />
            </label>
            <button
              type="button"
              disabled={suggestionsLoading || query.trim().length < 2}
              onClick={() => void searchSuggestions()}
            >
              {suggestionsLoading ? 'Buscando...' : 'Buscar'}
            </button>
          </div>

          {suggestions.length ? (
            <div className="trip-photo-suggestions-grid">
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion.id}
                  className="trip-photo-suggestion"
                  onClick={() => chooseSuggestion(suggestion)}
                >
                  <span
                    className="trip-photo-suggestion-image"
                    style={{ backgroundImage: `url("${suggestion.imageUrl}")` }}
                  />
                  <span className="trip-photo-suggestion-copy">
                    <strong>{suggestion.title}</strong>
                    <small>
                      {[suggestion.author, suggestion.license]
                        .filter(Boolean)
                        .join(' · ') || 'Wikimedia Commons'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : suggestionsLoading ? null : (
            <div className="trip-photo-suggestions-empty">
              <Sparkles size={17} />
              <span>
                Pesquise pelo destino para escolher uma imagem sugerida.
              </span>
            </div>
          )}
        </div>
      ) : null}

      {error ? <div className="trip-photo-picker-error">{error}</div> : null}
    </div>
  )
}
