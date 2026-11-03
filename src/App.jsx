import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Mail, FileText, ArrowUpRight, Linkedin } from "lucide-react";
import { motion } from "framer-motion";

const user = "jasper.j.blank";
const domain = "gmail.com";

// External links (itch.io, LessWrong) open in a new tab; on-site projects stay in place.
const linkProps = (href) =>
  /^https?:\/\//.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {};

const linkedinUrl = "https://www.linkedin.com/in/jasper-blank";

export default function PersonalWebsite() {
  // Add your work as it grows
  const projects = [
    {
      title: "Epistack — Claim Source Map",
      description:
        "A three-layer tool for contested claims: verbatim source quotes, a typed tree of Update Nodes, and a per-reader probability on top. Every percentage decomposes into an editable prior plus source-grounded shifts — no number without a quote and a reason.",
      link: "/epistack/",
      tags: ["JavaScript", "Epistemics", "Bayesian", "Interactive"],
    },
    {
      title: "You are a tornado",
      description:
        "Experience what it is like to be a tornado and bring ruin upon the land. A Katamari Damacy-inspired incremental game made in Godot, playable in the browser or as a Windows download.",
      link: "https://jasperblank.itch.io/you-are-a-tornado",
      linkLabel: "Play on itch.io",
      tags: ["Godot", "Game", "Incremental", "Physics"],
    },
  ]; // { title, description, link, linkLabel?, tags }

  // Shown as one small line of links under the project cards; the description becomes the hover text.
  const smallProjects = [
    {
      title: "Mind Chess",
      description:
        "A two-player bluff game: keep saying \"Check\" until someone commits to \"Checkmate.\" You win by calling it just before your opponent does. Keyboard-only input keeps commits hidden from the person sitting next to you.",
      link: "/mind-chess/",
      tags: ["JavaScript", "Game", "Bluff"],
    },
    {
      title: "1D Chess",
      description:
        "Chess collapsed to a single rank. Reachable-position graph and winning-tree viewers, plus a bot with transposition tables, killer moves, LMR, and MCTS.",
      link: "/1d-chess/",
      tags: ["JavaScript", "Game", "Search", "AI"],
    },
    {
      title: "Hex Tic Tac Toe",
      description:
        "A strategic tic-tac-toe variant on an infinite hexagonal grid. Players alternate 2-move turns, racing to get 6 in a row. Features an AI opponent with lookahead and threat visualization.",
      link: "/hex-tictactoe.html",
      tags: ["JavaScript", "Canvas", "Game", "AI"],
    },
    {
      title: "Boardgame Scorekeeper",
      description:
        "Per-game templates (Azul, Wingspan, …) with a fast score calculator. Plus mode adds 1–9 in single taps; calculator mode handles bigger sums. Everything persists in your browser.",
      link: "/scorekeeper/",
      tags: ["React", "TypeScript", "Local-first"],
    },
  ]; // { title, description, link, tags }
  const research = [
    {
      title: "Is GPT 2XL already clean?",
      venue: "LessWrong · October 2026",
      abstract:
        "Opus 5.5 is able to identify 3-19% of the neurons of GPT 2-XL based on activations. This is a big improvement over the 0.3% that GPT-4 was able to achieve in 2023.",
      link: "https://www.lesswrong.com/posts/drMv4SM2gaxk3oz3m/is-gpt-2xl-already-clean",
      linkLabel: "Read on LessWrong",
    },
  ]; // { title, venue?, abstract, link, linkLabel? }

  return (
    <><header className="flex items-center mb-12 space-x-4">
      <img
        src="/JB_logo.png"
        alt="Jasper Blank logo"
        className="w-12 h-12" />
      <h1 className="text-4xl font-extrabold">Jasper Blank</h1>
    </header><main className="flex flex-col items-center gap-8 px-4 py-16">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl"
        >
          <h1 className="text-4xl sm:text-6xl font-bold mb-4">Jasper Blank</h1>
          <p className="text-xl sm:text-2xl text-gray-600 dark:text-gray-300">
            Biorobotics Master passionate about merging biology & robotics to build adaptive machines.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <Button variant="default" size="lg" asChild>
              <a
                className="flex items-center gap-2"
                onClick={() => {
                  const email = [user, domain].join("@");
                  window.location.href = `mailto:${email}`;
                } }
              >
                <Mail size={18} />
                Contact
              </a>
            </Button>
            <Button variant="outline" asChild size="lg">
              <a href="/JasperBlank_CV.pdf" className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                CV
              </a>
            </Button>
            <Button variant="outline" asChild size="lg">
              <a href={linkedinUrl} className="flex items-center gap-2" {...linkProps(linkedinUrl)}>
                <Linkedin className="w-5 h-5" />
                LinkedIn
              </a>
            </Button>
          </div>
        </motion.section>

        {/* Projects */}
        <section className="w-full max-w-4xl">
          <h2 className="text-2xl font-semibold mb-4">Projects</h2>
          {projects.length === 0 ? (
            <p className="text-gray-500">No projects yet—stay tuned!</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {projects.map((p) => (
                <Card key={p.title} className="hover:shadow-lg transition-shadow">
                  <CardContent className="p-6 flex flex-col gap-4">
                    <h3 className="text-lg font-medium">{p.title}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {p.description}
                    </p>
                    {p.tags && (
                      <div className="flex flex-wrap gap-1.5">
                        {p.tags.map((tag) => (
                          <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.link && (
                      <Button asChild size="sm" className="self-start">
                        <a href={p.link} className="flex items-center gap-1.5" {...linkProps(p.link)}>
                          {p.linkLabel ?? "View project"} <ArrowUpRight size={14} />
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {smallProjects.length > 0 && (
            <p className="mt-6 text-sm text-gray-500">
              Small games &amp; tools:{" "}
              {smallProjects.map((p, i) => (
                <span key={p.title}>
                  {i > 0 && <span aria-hidden="true"> · </span>}
                  <a
                    href={p.link}
                    title={p.description}
                    className="whitespace-nowrap underline underline-offset-2 hover:text-gray-800"
                    {...linkProps(p.link)}
                  >
                    {p.title}
                  </a>
                </span>
              ))}
            </p>
          )}
        </section>

        {/* Research */}
        <section className="w-full max-w-4xl">
          <h2 className="text-2xl font-semibold mb-4">Research</h2>
          {research.length === 0 ? (
            <p className="text-gray-500">No publications yet.</p>
          ) : (
            <div className="space-y-6">
              {research.map((r) => (
                <Card key={r.title} className="hover:shadow-lg transition-shadow">
                  <CardContent className="p-6 flex flex-col gap-2">
                    <h3 className="text-lg font-medium">{r.title}</h3>
                    {r.venue && (
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {r.venue}
                      </p>
                    )}
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {r.abstract}
                    </p>
                    {r.link && (
                      <Button asChild size="sm" className="self-start mt-2">
                        <a href={r.link} className="flex items-center gap-1.5" {...linkProps(r.link)}>
                          {r.linkLabel ?? "Read"} <ArrowUpRight size={14} />
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main></>
  );
}
