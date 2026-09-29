type BrandProps = {
  compact?: boolean
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div
      className={`brand ${compact ? 'brand--compact' : ''}`}
      aria-label="Próximo Destino"
    >
      <img
        className="brand-mascot"
        src="/proximo-destino-mascote.webp"
        alt="Próximo Destino"
      />
    </div>
  )
}
