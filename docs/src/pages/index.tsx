import type { ReactNode } from "react";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import CodeBlock from "@theme/CodeBlock";
import styles from "./index.module.css";

const FEATURES: { title: string; text: string }[] = [
  {
    title: "No API, no tokens",
    text: "Works where web services are off or tokens aren't allowed: a real browser with the person's own login, single sign-on included. It never handles a password.",
  },
  {
    title: "Full control as any user",
    text: "Whatever the person can do: read courses and content, submit and answer as a student, grade, build activities, run forums and the gradebook as a teacher.",
  },
  {
    title: "Moodle's own services",
    text: "Calls the AJAX services Moodle's pages call, from a logged-in tab, and fills Moodle's own forms where no service helps, with Moodle's validation.",
  },
  {
    title: "Any language, any theme",
    text: "Reads Moodle by ids, data attributes, field names and URLs, never by visible text. Results are plain data with ISO dates.",
  },
  {
    title: "At a person's pace",
    text: "Student actions can read and answer page by page at a reader's pace, so Moodle logs views and completion as for a person.",
  },
  {
    title: "Ready for policies",
    text: "Every function declares the data it touches: own, course content, others' work, grading, communication. Allow only the kinds you trust.",
  },
];

const EXAMPLE = `import { createMoodle } from "@falkenslab/moodle-driver";

const moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/me/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn({ timeoutMs: 300_000 }); // a window opens only the first time

const courses = await moodle.listCourses();
const { submissions } = await moodle.assignmentSubmissions(35);
for (const s of submissions.filter((s) => s.needsGrading)) {
  await moodle.gradeSubmission(35, s.userId, { grade: "8", feedback: "<p>Good work.</p>" });
}
await moodle.close();`;

export default function Home(): ReactNode {
  return (
    <Layout title="Full control of Moodle through a browser" description="moodle-driver: a Node.js library to work Moodle as any user, through a browser, with no API or tokens">
      <header className={styles.hero}>
        <div className="container">
          <h1 className={styles.title}>
            <img className={styles.logo} src={useBaseUrl("/img/logo.svg")} alt="" /> moodle-driver
          </h1>
          <p className={styles.tagline}>Full control of Moodle as any user, through a browser: no API, no web services, no tokens.</p>
          <div className={styles.buttons}>
            <Link className="button button--primary button--lg" to="/getting-started/installation">
              Get started
            </Link>
            <Link className="button button--secondary button--lg" to="/areas/courses">
              Moodle areas
            </Link>
            <Link className="button button--secondary button--lg" to="/api">
              API reference
            </Link>
          </div>
        </div>
      </header>
      <main className="container margin-vert--xl">
        <div className="row">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="col col--4 margin-bottom--lg">
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </div>
          ))}
        </div>
        <div className="row margin-top--lg">
          <div className="col col--8 col--offset-2">
            <h2>Log in once, then work the site</h2>
            <p>
              The person logs in by hand in a browser window, once; the session stays in a profile on disk. Every operation is a method of the
              Moodle object, takes ids and options, and returns plain data.
            </p>
            <CodeBlock language="ts">{EXAMPLE}</CodeBlock>
          </div>
        </div>
      </main>
    </Layout>
  );
}
