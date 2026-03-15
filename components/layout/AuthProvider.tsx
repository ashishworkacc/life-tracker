'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (loading) return

    const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname === '/'

    if (!user && !isAuthPage) {
      router.replace(`/login?from=${pathname}`)
    } else if (user && isAuthPage) {
      router.replace('/command-center')
    }
  }, [user, loading, pathname, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
          <p className="text-sm text-muted">Loading LifeTracker...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
