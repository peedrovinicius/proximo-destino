type BrandProps = {
  compact?: boolean
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="Próximo Destino">
      <span className="brand-badge">
        <img
          className="brand-mascot"
          src="/proximo-destino-mascote-exato.webp?v=7"
          alt="Próximo Destino"
        />
      </span>
    </div>
  )
}
