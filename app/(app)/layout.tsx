'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import BottomNav from '@/components/layout/BottomNav'
import TopBar from '@/components/layout/TopBar'
import SideNav from '@/components/layout/SideNav'
import FloatingActions from '@/components/layout/FloatingActions'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="w-10 h-10 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>

      {/* ── Desktop sidebar (lg+) ── */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 z-40" style={{ width: 220 }}>
        <SideNav />
      </aside>

      {/* ── Mobile top bar (< lg) ── */}
      <div className="lg:hidden">
        <TopBar />
      </div>

      {/* ── Main content ── */}
      {/* Mobile: narrow centered column with bottom-nav padding            */}
      {/* Desktop: starts after 220px sidebar, wider content, no nav offset */}
      <main className="
        max-w-lg mx-auto px-4 pb-safe pt-2
        lg:max-w-none lg:mx-0 lg:px-10 lg:pt-8 lg:pb-12
        lg:app-main-desktop
      ">
        {/* Inner wrapper gives a sensible max width on large monitors */}
        <div className="lg:max-w-6xl lg:mx-auto">
          {children}
        </div>
      </main>

      {/* ── Mobile bottom nav (< lg) ── */}
      <div className="lg:hidden">
        <BottomNav />
      </div>

      <FloatingActions />
    </div>
  )
}
