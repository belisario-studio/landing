"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

export default function Navigation() {
  return (
    <nav className="absolute top-0 w-full z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-2xl font-bold tracking-tight opacity-25">
          Belisario
        </Link>

        <div className="flex gap-8 items-center font-semibold">
          <Link
            href="/careers"
            className="text-sm transition-colors text-muted-foreground hover:text-foreground"
          >
            Careers
          </Link>
          {/*
          <Link
            href="/contact"
            className={`text-sm transition-colors ${
              isActive("/contact") ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Contact
          </Link>
          */}
        </div>
      </div>
    </nav>
  )
}
