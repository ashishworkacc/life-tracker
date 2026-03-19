'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function WeightRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/health') }, [router])
  return null
}
