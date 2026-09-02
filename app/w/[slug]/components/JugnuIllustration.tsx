'use client'

// Large jugnu avatar with firefly wings + antennae — matches the mockup illustration style
const WING_PATHS: Record<string, { left: string; right: string; blob: string; antenna: string }> = {
  maya: {
    blob:    'M80,90 C40,70 20,40 50,20 C70,8 110,8 130,20 C160,40 140,70 80,90Z',
    left:    'M72,72 C50,55 28,65 22,82 C16,98 30,115 55,108 C65,105 72,95 72,85Z',
    right:   'M88,72 C110,55 132,65 138,82 C144,98 130,115 105,108 C95,105 88,95 88,85Z',
    antenna: 'M76,34 C74,22 68,14 62,8 M84,34 C86,22 92,14 98,8',
  },
  nia: {
    blob:    'M80,90 C35,75 15,45 45,22 C65,8 115,8 135,22 C165,45 125,75 80,90Z',
    left:    'M70,75 C48,55 22,60 18,80 C14,100 32,118 58,108 C68,104 72,92 70,82Z',
    right:   'M90,75 C112,55 138,60 142,80 C146,100 128,118 102,108 C92,104 88,92 90,82Z',
    antenna: 'M75,32 C70,20 62,12 55,5 M85,32 C90,20 98,12 105,5',
  },
  leo: {
    blob:    'M80,92 C38,78 18,48 48,24 C66,10 114,10 132,24 C162,48 122,78 80,92Z',
    left:    'M71,74 C46,52 20,58 16,78 C12,98 32,120 60,110 C70,106 73,93 71,83Z',
    right:   'M89,74 C114,52 140,58 144,78 C148,98 128,120 100,110 C90,106 87,93 89,83Z',
    antenna: 'M76,33 C72,20 65,11 58,4 M84,33 C88,20 95,11 102,4',
  },
  tara: {
    blob:    'M80,88 C42,72 22,44 50,22 C68,9 112,9 130,22 C158,44 118,72 80,88Z',
    left:    'M72,73 C50,54 24,62 20,80 C16,98 34,116 58,108 C68,104 73,91 72,81Z',
    right:   'M88,73 C110,54 136,62 140,80 C144,98 126,116 102,108 C92,104 87,91 88,81Z',
    antenna: 'M76,34 C73,21 66,13 60,6 M84,34 C87,21 94,13 100,6',
  },
}

const COLORS: Record<string, string> = {
  maya: '#8b5cf6',
  nia:  '#ec4899',
  leo:  '#06b6d4',
  tara: '#10b981',
}

interface Props {
  jugnuKey: string
  size?: number
}

export function JugnuIllustration({ jugnuKey, size = 100 }: Props) {
  const paths  = WING_PATHS[jugnuKey] ?? WING_PATHS.maya
  const color  = COLORS[jugnuKey] ?? '#6366f1'
  const initials = jugnuKey.slice(0, 2).toUpperCase()
  const scale  = size / 160

  return (
    <svg
      width={size}
      height={size * 1.1}
      viewBox="0 0 160 176"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: 'visible', flexShrink: 0 }}
    >
      {/* Color blob behind */}
      <path d={paths.blob} fill={color} opacity="0.18" />

      {/* Wings */}
      <path d={paths.left}  fill={color} opacity="0.30" />
      <path d={paths.right} fill={color} opacity="0.30" />
      <path d={paths.left}  fill="none" stroke={color} strokeWidth="1.5" opacity="0.50" strokeDasharray="4 3" />
      <path d={paths.right} fill="none" stroke={color} strokeWidth="1.5" opacity="0.50" strokeDasharray="4 3" />

      {/* Antennae */}
      <path d={paths.antenna} stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.8" />
      {/* Antenna tips */}
      <circle cx="62" cy="8"  r="3" fill={color} opacity="0.9" />
      <circle cx="98" cy="8"  r="3" fill={color} opacity="0.9" />

      {/* Avatar circle */}
      <circle cx="80" cy="100" r="38" fill={color} />
      <circle cx="80" cy="100" r="38" fill="white" opacity="0.15" />

      {/* Initials */}
      <text
        x="80" y="107"
        textAnchor="middle"
        fill="white"
        fontSize="18"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {initials}
      </text>
    </svg>
  )
}
