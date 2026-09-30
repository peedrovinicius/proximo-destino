type BrandProps = {
  compact?: boolean
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="Próximo Destino">
      <span className="brand-badge">
        <img
          className="brand-mascot"
          src="/proximo-destino-logo.jpg?v=6"
          alt="Próximo Destino"
        />
      </span>
    </div>
  )
}
