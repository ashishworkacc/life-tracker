import { redirect } from 'next/navigation'

// Root page redirects to login
// Once authenticated, login redirects to /command-center
export default function RootPage() {
  redirect('/login')
}
