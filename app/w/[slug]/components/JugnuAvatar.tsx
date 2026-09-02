'use client'

const STATUS_RING: Record<string, string> = {
  idle:      'ring-gray-300',
  working:   'ring-indigo-500 animate-pulse',
  reviewing: 'ring-yellow-400 animate-pulse',
  blocked:   'ring-red-400',
  done:      'ring-emerald-400',
}

const STATUS_LABEL: Record<string, string> = {
  idle:      'Idle',
  working:   'Working…',
  reviewing: 'Reviewing…',
  blocked:   'Blocked',
  done:      'Done',
}

interface Props {
  name: string
  role: string
  color: string
  status: string
  task?: string
  size?: 'sm' | 'md'
}

export function JugnuAvatar({ name, role, color, status, task, size = 'md' }: Props) {
  const initials = name.slice(0, 2).toUpperCase()
  const dim = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'

  return (
    <div className="flex items-center gap-3">
      <div className={`relative shrink-0 ${dim} rounded-full ring-2 ${STATUS_RING[status] ?? 'ring-gray-300'} flex items-center justify-center font-bold text-white`}
        style={{ backgroundColor: color }}>
        {initials}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 leading-tight">{name}
          <span className="ml-1.5 text-xs font-normal text-gray-500">{role}</span>
        </p>
        <p className="text-xs text-gray-400 truncate">{task ?? STATUS_LABEL[status] ?? status}</p>
      </div>
    </div>
  )
}
