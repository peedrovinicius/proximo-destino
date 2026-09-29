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
        src="/proximo-destino-mascote.png?v=2"
        alt="Próximo Destino"
        width="256"
        height="256"
      />
    </div>
  )
}
