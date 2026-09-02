'use client'

// Per-jugnu DiceBear seed + brand ring color
const CONFIG: Record<string, { seed: string; ring: string; bg: string }> = {
  maya: { seed: 'Maya-planner',   ring: '#8b5cf6', bg: 'b6a5f5' },
  nia:  { seed: 'Nia-designer',   ring: '#ec4899', bg: 'f9a8d4' },
  leo:  { seed: 'Leo-builder',    ring: '#06b6d4', bg: 'a5f3fc' },
  tara: { seed: 'Tara-reviewer',  ring: '#10b981', bg: '6ee7b7' },
}

interface Props {
  jugnuKey: string
  size?: number
}

export function JugnuIllustration({ jugnuKey, size = 44 }: Props) {
  const cfg = CONFIG[jugnuKey] ?? CONFIG.maya
  const src = `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(cfg.seed)}&backgroundColor=${cfg.bg}`

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        border: `2.5px solid ${cfg.ring}`,
        flexShrink: 0,
        background: `#${cfg.bg}`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={jugnuKey} width={size} height={size} style={{ display: 'block' }} />
    </div>
  )
}
