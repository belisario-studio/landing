import type React from "react"
import type { Metadata } from "next"
import { Bebas_Neue } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"

const _Bebas_Neue = Bebas_Neue({ 
  weight: "400",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Belisario Studio - Game Development",
  description: "Belisario Studio - Creating immersive gaming experiences",
  generator: "v0.app",
  icons: {
    icon: '/icon.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`font-sans antialiased bg-background text-foreground`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
