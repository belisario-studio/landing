"use client"

import { useState, type FormEvent } from "react"
import { toast } from "sonner"

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function NewsletterSignup() {
  const [email, setEmail] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!isValidEmail(email)) {
      toast.error("Enter a valid email address.")
      return
    }

    setIsSubmitting(true)

    setTimeout(() => {
      setIsSubmitting(false)
      setEmail("")
      toast.success("You're on the list", {
        description: "We'll be in touch soon.",
      })
    }, 600)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col items-center gap-3 w-full max-w-sm">
      <div className="flex items-end gap-4 border-b border-[#3a3a3a] pb-2.5 w-full">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          aria-label="Email address"
          disabled={isSubmitting}
          className="flex-1 bg-transparent border-none text-foreground text-base tracking-tight placeholder:text-[#5a5a5a] focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          aria-label="Subscribe"
          className="flex-none w-8 h-8 flex items-center justify-center border border-[#3a3a3a] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:opacity-50 active:scale-95"
        >
          →
        </button>
      </div>
      <p className="text-[0.68rem] tracking-widest uppercase text-[#6a6a6a]">
        Occasional news on what we&apos;re building. No spam.
      </p>
    </form>
  )
}
