'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SleepRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/health') }, [router])
  return null
}
