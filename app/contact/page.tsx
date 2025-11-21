"use client"

import { useState, type FormEvent } from "react"
import Navigation from "@/components/navigation"

export default function Contact() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState("")

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitMessage("")

    // Simulate form submission
    setTimeout(() => {
      setIsSubmitting(false)
      setSubmitMessage("Thank you for reaching out! We'll get back to you soon.")
      e.currentTarget.reset()
    }, 1000)
  }

  return (
    <>
      <Navigation />
      <main className="min-h-screen pt-24 pb-16">
        <div className="max-w-2xl mx-auto px-6">
          <div className="mb-16 space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold text-balance">Get In Touch</h1>
            <p className="text-xl text-muted-foreground">
              Have a question or partnership inquiry? We'd love to hear from you.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-2">
                Name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                className="w-full px-4 py-3 bg-card border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground transition-colors"
                placeholder="Your name"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                required
                className="w-full px-4 py-3 bg-card border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground transition-colors"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label htmlFor="subject" className="block text-sm font-medium mb-2">
                Subject
              </label>
              <input
                type="text"
                id="subject"
                name="subject"
                required
                className="w-full px-4 py-3 bg-card border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground transition-colors"
                placeholder="What is this about?"
              />
            </div>

            <div>
              <label htmlFor="message" className="block text-sm font-medium mb-2">
                Message
              </label>
              <textarea
                id="message"
                name="message"
                required
                rows={6}
                className="w-full px-4 py-3 bg-card border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground transition-colors resize-none"
                placeholder="Your message here..."
              />
            </div>

            {submitMessage && (
              <div className="p-4 bg-card border border-green-500 text-green-400 text-sm">{submitMessage}</div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full px-6 py-3 bg-foreground text-background hover:opacity-90 transition-all duration-200 disabled:opacity-50 font-medium"
            >
              {isSubmitting ? "Sending..." : "Send Message"}
            </button>
          </form>

          <div className="mt-16 pt-8 border-t border-border grid md:grid-cols-2 gap-8">
            <div>
              <h3 className="font-semibold mb-2">Email</h3>
              <a
                href="mailto:hello@belisariostudio.com"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                hello@belisariostudio.com
              </a>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Follow Us</h3>
              <div className="flex gap-4">
                <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">
                  Twitter
                </a>
                <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">
                  Discord
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
