'use client'

// Position of the circular head window on each body PNG (as % of body width/height)
// left/top = center of the circle, size = diameter as % of body width
const HEAD: Record<string, { left: string; top: string; size: string }> = {
  nia:  { left: '46%', top: '38%', size: '34%' },
  maya: { left: '35%', top: '43%', size: '34%' },
  leo:  { left: '45%', top: '44%', size: '34%' },
  tara: { left: '42%', top: '45%', size: '34%' },
}

interface Props {
  jugnuKey: string
  size?: number  // body width in px
}

// Body PNG aspect ratio: 384 × 570
const ASPECT = 570 / 384

export function JugnuIllustration({ jugnuKey, size = 120 }: Props) {
  const h = HEAD[jugnuKey] ?? HEAD.nia
  const bodyH = Math.round(size * ASPECT)

  return (
    <div style={{ position: 'relative', width: size, height: bodyH, flexShrink: 0 }}>
      {/* Jugnu body illustration */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/jugnus/body_${jugnuKey}.png`}
        alt=""
        width={size}
        height={bodyH}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />

      {/* Face photo overlaid in the circular head window */}
      <div
        style={{
          position: 'absolute',
          left: h.left,
          top: h.top,
          width: h.size,
          aspectRatio: '1',
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          overflow: 'hidden',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/jugnus/face_${jugnuKey}.png`}
          alt={jugnuKey}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%' }}
        />
      </div>
    </div>
  )
}
