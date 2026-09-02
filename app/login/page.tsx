'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createAnonClient } from '@/lib/supabase/server'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const db = createAnonClient()
    const { data, error: authError } = await db.auth.signInWithPassword({ email, password })

    if (authError || !data.user) {
      setError(authError?.message ?? 'Login failed')
      setLoading(false)
      return
    }

    // Find user's workspace
    const workspaceRes = await fetch(`/api/workspaces?ownerId=${data.user.id}`)
    const { slug } = await workspaceRes.json()
    router.push(slug ? `/w/${slug}` : '/signup')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <span className="text-2xl font-bold text-indigo-600">✦ Jugnus</span>
          <p className="text-sm text-gray-500">Welcome back</p>
        </div>

        <form onSubmit={handleLogin} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          New here?{' '}
          <Link href="/signup" className="text-indigo-600 font-medium hover:underline">Get started</Link>
        </p>
      </div>
    </div>
  )
}
