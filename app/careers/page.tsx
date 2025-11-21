import Navigation from "@/components/navigation"
import Link from "next/link"

export default function Careers() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-3 md:px-6">
          <div className="mb-8 md:mb-16 space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold text-balance">Careers</h1>
          </div>

          <div className="space-y-6">
            <div className="border border-border p-4 md:p-8 hover:border-foreground transition-colors">
              <div className="mb-3 md:mb-4">
                <h3 className="text-2xl font-semibold mb-2">Game Developer Intern</h3>
                <div className="flex gap-4 text-muted-foreground text-sm mb-4 md:mb-6">
                  <span>Remote</span>
                  <span>•</span>
                  <span>Part-time (25 hours/week)</span>
                </div>
              </div>

              <div className="space-y-4 md:space-y-6">
                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Summary</h4>
                  <p className="text-muted-foreground">
                    We are seeking a technical intern who combines an engineering mindset with artistic versatility.
                    Core Responsibilities include Godot development, asset integration, and prototyping.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Key Responsibilities</h4>
                  <ul className="text-muted-foreground space-y-2 list-disc list-inside">
                    <li>Development: Implement gameplay mechanics, UI, and systems using GDScript in Godot</li>
                    <li>
                      Asset Integration: Import 3D models and textures; perform minor technical adjustments in Blender
                    </li>
                    <li>
                      Prototyping: Create functional prototypes using placeholder art/sketches to validate mechanics
                    </li>
                    <li>Engineering: Write modular, maintainable code applying OOP principles and Design Patterns</li>
                    <li>Version Control: Manage source code via Git (pull requests, merges, conflict resolution)</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Requirements</h4>
                  <ul className="text-muted-foreground space-y-2 list-disc list-inside">
                    <li>Student in CS, Software Engineering, or equivalent</li>
                    <li>
                      Solid understanding of engineering fundamentals, OOP, and design patterns (Singleton, State,
                      Observer, etc.)
                    </li>
                    <li>English proficiency</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Nice to Have</h4>
                  <ul className="text-muted-foreground space-y-2 list-disc list-inside">
                    <li>Godot Proficiency: Strong grasp of the engine and GDScript</li>
                    <li>Git: Practical experience with version control workflows</li>
                    <li>Blender: navigation, simple geometry fixes, UVs, etc.</li>
                    <li>Artistic Eye: Drawing/sketching</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">We Offer</h4>
                  <ul className="text-muted-foreground space-y-2 list-disc list-inside">
                    <li>25-hour work week</li>
                    <li>USD 400 monthly (paid in ARS)</li>
                    <li>30 days of PTO (per year)</li>
                    <li>Company laptop provided</li>
                    <li>Raise based on performance evaluation</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Hiring Process</h4>
                  <ul className="text-muted-foreground space-y-2 list-disc list-inside">
                    <li>Interview</li>
                    <li>Technical Challenge (take-home)</li>
                    <li>Challenge Defense</li>
                  </ul>
                </div>
              </div>

              <a
                href="mailto:emilia@belisario.studio?subject=Application for Game Developer Intern"
                className="inline-block mt-6 md:mt-8 px-6 py-2 border border-foreground text-foreground hover:bg-foreground hover:text-background transition-all duration-200 text-sm"
              >
                Apply Now
              </a>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
