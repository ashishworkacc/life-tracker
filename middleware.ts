import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Auth is handled client-side by AppLayout (lib/hooks/useAuth).
// Middleware passes all requests through — no server-side cookie check needed.
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js).*)',
  ],
}
