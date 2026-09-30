type BrandProps = {
  compact?: boolean
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="Próximo Destino">
      <span className="brand-badge">
        <img
          className="brand-mascot"
          src="/proximo-destino-logo-retina.jpg?v=9"
          alt="Próximo Destino"
          width="180"
          height="180"
        />
      </span>
    </div>
  )
}
