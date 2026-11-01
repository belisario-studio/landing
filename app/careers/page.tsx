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
                  <span>Argentina</span>
                  <span>•</span>
                  <span>Part-time (25 hours/week)</span>
                </div>
              </div>

              <div className="space-y-4 md:space-y-6">
                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Summary</h4>
                  <p className="text-foreground opacity-75">
                    We are seeking a technical intern who combines an engineering mindset with artistic versatility.
                    Godot development, asset integration, and prototyping.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Key Responsibilities</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>Development: Implement gameplay mechanics, UI, and systems using GDScript in Godot</li>
                    <li>
                      Asset Integration: Import 3D models and textures; perform minor technical adjustments in Blender
                    </li>
                    <li>
                      Prototyping: Create functional prototypes using placeholder art/sketches to validate mechanics
                    </li>
                    <li>Engineering: Write modular, maintainable code applying OOP principles and Design Patterns</li>
                    <li>Version Control: Manage source code via Git</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Requirements</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>Student in CS, Software Engineering, or equivalent</li>
                    <li>
                      Solid understanding of engineering fundamentals, OOP, and design patterns
                    </li>
                    <li>English proficiency</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Nice to Have</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>Godot Proficiency: Strong grasp of the engine and GDScript</li>
                    <li>Git: Practical experience with version control workflows</li>
                    <li>Blender: navigation, simple geometry fixes, UVs, etc.</li>
                    <li>Artistic Eye: Drawing/sketching</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">We Offer</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>25-hour work week</li>
                    <li>USD 300-500 monthly (paid in ARS)</li>
                    <li>30 days of PTO (per year)</li>
                    <li>Company laptop provided</li>
                    <li>Raise based on performance evaluation</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Hiring Process</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>Apply</li>
                    <li>Interview</li>
                    <li>Technical challenge (take-home)</li>
                    <li>Challenge defense interview</li>
                    <li>Offer</li>
                  </ul>
                </div>
              </div>

              <a
                href="https://docs.google.com/forms/d/e/1FAIpQLSdBGUNLJL3pIF_gVWC25vPo9hMNKqpBglqzM3X86tK59Jjd6g/viewform?usp=pp_url&entry.1806672953=Game+Developer+Intern"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-6 md:mt-8 px-6 py-2 border border-foreground text-foreground hover:bg-foreground hover:text-background transition-all duration-200 text-sm"
              >
                Apply Now
              </a>
              <p className="text-muted-foreground text-xs mt-2 opacity-0 select-none">or directly to</p>
            </div>

            <div className="border border-border p-4 md:p-8 hover:border-foreground transition-colors">
              <div className="mb-3 md:mb-4">
                <h3 className="text-2xl font-semibold mb-2">Community Manager Trainee</h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm mb-4 md:mb-6">
                  <span>Remote</span>
                  <span>•</span>
                  <span>Argentina</span>
                  <span>•</span>
                  <span>Independent contractor (paid per post)</span>
                </div>
              </div>

              <div className="space-y-4 md:space-y-6">
                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Summary</h4>
                  <p className="text-foreground opacity-75">
                    Entry-level role, no prior experience required. You will grow our three new social accounts, one
                    in Spanish, one in English and one in Portuguese, using AI as a support tool in your daily
                    workflow. You propose posts, we approve them, you publish. Pay starts per post and goes
                    up as the accounts hit growth milestones.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Key Responsibilities</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>Proposals: Submit post proposals (copy and visuals) for approval before publishing</li>
                    <li>Publishing: Publish approved posts on schedule across the three accounts</li>
                    <li>
                      Localization: Write each post in Spanish and use AI to translate it into English and Portuguese
                    </li>
                    <li>Formats: Text posts, image posts/carousels, TikToks/Reels/Shorts and YouTube videos</li>
                    <li>
                      AI Use: Use AI to translate, proofread and polish your drafts, research trends and topics, and
                      speed up video editing. Generating images or videos from scratch with generative AI is not allowed: all
                      visuals must be made by you or provided by the team
                    </li>
                    <li>Community: Reply to comments and messages, and flag relevant feedback to the team</li>
                    <li>Reporting: Share a short monthly report with the main metrics of each account</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Requirements</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>Native or near-native Spanish</li>
                    <li>Daily user of social media, especially gaming communities</li>
                    <li>Comfortable using AI as a support tool, or eager to learn</li>
                    <li>Judgment to spot when AI output is wrong, generic or off-brand</li>
                    <li>Reliability: meeting the agreed publishing schedule</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">How It Works</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>You send a batch of post proposals for the week</li>
                    <li>We approve, request changes, or reject each one</li>
                    <li>You publish the approved posts on the agreed dates</li>
                    <li>You get paid for every approved post once it is published. Rejected proposals are not paid</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Nice to Have</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>Basic graphic design</li>
                    <li>Short-form video editing</li>
                    <li>Interest in video games and indie game development</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Pay per Post (ARS)</h4>
                  <p className="text-foreground opacity-75 mb-3">
                    Rates below are for the original post. Each translated version published on another account is
                    paid at 20% of the rate, or 30% if the visual has to be re-edited (text in an image, subtitles in a
                    video). A post created specifically for the English or Portuguese account, not a translation, is
                    paid as a full original post. Videos outside these lengths are priced when the proposal is approved.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border border-border">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="p-2 md:p-3 font-semibold">Format</th>
                          <th className="p-2 md:p-3 font-semibold">Level 1</th>
                          <th className="p-2 md:p-3 font-semibold">Level 2</th>
                          <th className="p-2 md:p-3 font-semibold">Level 3</th>
                        </tr>
                      </thead>
                      <tbody className="opacity-75">
                        <tr className="border-b border-border">
                          <td className="p-2 md:p-3">Text only</td>
                          <td className="p-2 md:p-3">3,000</td>
                          <td className="p-2 md:p-3">6,000</td>
                          <td className="p-2 md:p-3">10,000</td>
                        </tr>
                        <tr className="border-b border-border">
                          <td className="p-2 md:p-3">Image / carousel</td>
                          <td className="p-2 md:p-3">5,000</td>
                          <td className="p-2 md:p-3">12,000</td>
                          <td className="p-2 md:p-3">20,000</td>
                        </tr>
                        <tr className="border-b border-border">
                          <td className="p-2 md:p-3">TikTok / Reel / Short (vertical, up to 90 s)</td>
                          <td className="p-2 md:p-3">10,000</td>
                          <td className="p-2 md:p-3">30,000</td>
                          <td className="p-2 md:p-3">50,000</td>
                        </tr>
                        <tr>
                          <td className="p-2 md:p-3">YouTube video (horizontal, 4 to 15 min)</td>
                          <td className="p-2 md:p-3">25,000</td>
                          <td className="p-2 md:p-3">60,000</td>
                          <td className="p-2 md:p-3">100,000</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">How to Level Up</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>All three accounts are new and start at zero followers</li>
                    <li>Level 1: Starting rate</li>
                    <li>
                      Level 2: 1,000 combined followers across the three accounts and 20,000 combined monthly views,
                      sustained for 2 consecutive months
                    </li>
                    <li>
                      Level 3: at least 3 months at Level 2, 15,000 combined followers, 300,000 combined monthly views
                      sustained for 3 consecutive months, and at least one piece over 100,000 views
                    </li>
                    <li>Levels are reviewed monthly and are never lowered once reached</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">We Offer</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>Flexible schedule, no fixed hours</li>
                    <li>Monthly payment for every approved and published post (paid in ARS)</li>
                    <li>Raw footage and assets provided for video content</li>
                    <li>Training support when you need it (e.g. a graphic design or video editing course)</li>
                    <li>Pay increases tied to clear, measurable results</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Contract</h4>
                  <p className="text-foreground opacity-75">
                    This is an independent contractor role, not an employment position. You invoice us monthly for
                    the posts published that month.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Hiring Process</h4>
                  <ul className="text-foreground space-y-2 list-disc list-inside opacity-75">
                    <li>Apply</li>
                    <li>Interview</li>
                    <li>
                      Content challenge: one post proposal in Spanish, English and Portuguese (AI allowed for
                      translation, proofreading and research)
                    </li>
                    <li>Offer</li>
                  </ul>
                </div>
              </div>

              <a
                href="https://docs.google.com/forms/d/e/1FAIpQLSdBGUNLJL3pIF_gVWC25vPo9hMNKqpBglqzM3X86tK59Jjd6g/viewform?usp=pp_url&entry.1806672953=Community+Manager+Trainee"
                target="_blank"
                rel="noopener noreferrer"
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
