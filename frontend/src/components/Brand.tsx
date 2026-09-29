type BrandProps = {
  compact?: boolean
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <div className="brand-symbol" aria-hidden="true">
        <span>PD</span>
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
