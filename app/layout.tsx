import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'GMagent114',
  description: 'One Fourteen Virtual GM — Phase 1 scaffold',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
