'use client'

interface Props {
  jugnuKey: string
  size?: number
}

// Aspect ratio of the extracted character PNGs: 256 × 248
const ASPECT = 248 / 256

export function JugnuIllustration({ jugnuKey, size = 120 }: Props) {
  const h = Math.round(size * ASPECT)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/jugnus/jugnu_${jugnuKey}.png`}
      alt={jugnuKey}
      width={size}
      height={h}
      style={{ width: size, height: h, objectFit: 'contain', flexShrink: 0, display: 'block' }}
    />
  )
}
