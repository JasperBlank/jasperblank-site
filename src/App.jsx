import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Mail, FileText } from "lucide-react";
import { motion } from "framer-motion";

const user = "jasper.j.blank";
const domain = "gmail.com";

export default function PersonalWebsite() {
  // Add your work as it grows
  const projects = []; // { title, description, link }
  const research = []; // { title, abstract, link }

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
          <div className="mt-6 flex justify-center gap-4">
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
                    {p.link && (
                      <Button asChild size="sm">
                        <a href={p.link}>View</a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
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
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {r.abstract}
                    </p>
                    {r.link && (
                      <Button asChild size="sm">
                        <a href={r.link}>Read</a>
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
