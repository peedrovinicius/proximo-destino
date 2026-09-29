import { Plane } from 'lucide-react'

type BrandProps = {
  compact?: boolean
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <div className="brand-symbol" aria-label="Próximo Destino">
        <span className="brand-orbit" />
        <Plane size={20} strokeWidth={2.2} />
      </div>
      {!compact && (
        <div className="brand-text">
          <strong>Próximo Destino</strong>
          <small>Turismo e viagens</small>
        </div>
      )}
    </div>
  )
}
