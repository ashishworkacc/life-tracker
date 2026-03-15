'use client'

import { useState, useEffect } from 'react'
import { useAuth } from './useAuth'
import { subscribeToDocument } from '@/lib/firebase/db'

interface PlanState {
  plan: 'free' | 'pro'
  isPro: boolean
  loading: boolean
}

export function usePlan(): PlanState {
  const { user, loading: authLoading } = useAuth()
  const [plan, setPlan] = useState<'free' | 'pro'>('pro') // Default pro (free launch)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setPlan('free')
      setLoading(false)
      return
    }

    const unsubscribe = subscribeToDocument('users', user.uid, data => {
      setPlan((data?.plan as 'free' | 'pro') ?? 'pro')
      setLoading(false)
    })

    return unsubscribe
  }, [user, authLoading])

  return { plan, isPro: plan === 'pro', loading }
}
