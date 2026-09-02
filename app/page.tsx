import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
        <span className="text-xl font-bold text-indigo-600">✦ Jugnus</span>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">Sign in</Link>
          <Link href="/signup" className="text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24 space-y-8">
        <div className="space-y-4 max-w-2xl">
          <h1 className="text-5xl font-bold tracking-tight text-gray-900 leading-tight">
            Tell Jugnus what<br />you want done.
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed">
            Your AI team figures out the rest. Describe your goal — Maya assembles the right jugnus, they plan and build, you review the result.
          </p>
        </div>

        {/* Jugnu avatars */}
        <div className="flex items-center gap-3">
          {[
            { name: 'Maya', role: 'Planner', color: '#8b5cf6' },
            { name: 'Nia',  role: 'Designer', color: '#ec4899' },
            { name: 'Leo',  role: 'Builder', color: '#06b6d4' },
            { name: 'Tara', role: 'Reviewer', color: '#10b981' },
          ].map((j) => (
            <div key={j.name} className="flex flex-col items-center gap-1.5">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white ring-2 ring-white shadow-md"
                style={{ backgroundColor: j.color }}
              >
                {j.name.slice(0, 2)}
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-gray-800">{j.name}</p>
                <p className="text-xs text-gray-400">{j.role}</p>
              </div>
            </div>
          ))}
        </div>

        <Link
          href="/signup"
          className="inline-flex items-center gap-2 px-8 py-3.5 text-base font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
        >
          ✨ Assemble your team
        </Link>

        <p className="text-sm text-gray-400">Builds on Next.js + Supabase + Vercel. No setup required.</p>
      </main>

      {/* How it works */}
      <section className="border-t border-gray-100 px-8 py-16">
        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          {[
            { step: '1', title: 'Describe your goal', desc: 'Tell Maya what you want to build. She asks only what she needs to know.' },
            { step: '2', title: 'Jugnus get to work', desc: 'Nia designs it. Leo builds it. Tara reviews it. No hand-holding required.' },
            { step: '3', title: 'You review the PR', desc: 'Your jugnus open a GitHub PR. You approve, it ships.' },
          ].map((item) => (
            <div key={item.step} className="space-y-2">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-sm font-bold flex items-center justify-center mx-auto">
                {item.step}
              </div>
              <h3 className="font-semibold text-gray-900">{item.title}</h3>
              <p className="text-sm text-gray-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
