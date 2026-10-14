import type { ReactNode } from "react";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Translate, { translate } from "@docusaurus/Translate";
import Layout from "@theme/Layout";
import CodeBlock from "@theme/CodeBlock";
import styles from "./index.module.css";

// A function, so translate() runs with the page's locale.
const features = (): { title: string; text: string }[] => [
  {
    title: translate({ id: "home.feature1.title", message: "No web services, no tokens" }),
    text: translate({ id: "home.feature1.text", message: "Works where web services are off or tokens aren't allowed: the person logs in once, single sign-on and two-factor included, and the driver works with that session. It never handles a password." }),
  },
  {
    title: translate({ id: "home.feature2.title", message: "Full control as any user" }),
    text: translate({ id: "home.feature2.text", message: "Whatever the person can do: read courses and content, submit and answer as a student, grade, build activities, run forums and the gradebook as a teacher." }),
  },
  {
    title: translate({ id: "home.feature3.title", message: "Moodle's own services" }),
    text: translate({ id: "home.feature3.text", message: "Calls the AJAX services Moodle's pages call, with the person's session, and fills Moodle's own forms where no service helps, with Moodle's validation." }),
  },
  {
    title: translate({ id: "home.feature4.title", message: "Any language, any theme" }),
    text: translate({ id: "home.feature4.text", message: "Reads Moodle by ids, data attributes, field names and URLs, never by visible text. Results are plain data with ISO dates." }),
  },
  {
    title: translate({ id: "home.feature5.title", message: "At a person's pace" }),
    text: translate({ id: "home.feature5.text", message: "Student actions can read and answer page by page at a reader's pace, so Moodle logs views and completion as for a person." }),
  },
  {
    title: translate({ id: "home.feature6.title", message: "Ready for policies" }),
    text: translate({ id: "home.feature6.text", message: "Every function declares the data it touches: own, course content, others' work, grading, communication. Allow only the kinds you trust." }),
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
    <Layout
      title={translate({ id: "home.title", message: "Full control of Moodle with your own login" })}
      description={translate({ id: "home.description", message: "moodle-driver: a Node.js library to work Moodle as any user, with their own login: no web services, no tokens, no admin" })}
    >
      <header className={styles.hero}>
        <div className="container">
          <h1 className={styles.title}>
            <img className={styles.logo} src={useBaseUrl("/img/logo.svg")} alt="" /> moodle-driver
          </h1>
          <p className={styles.tagline}>
            <Translate id="home.tagline">Full control of Moodle as any user, with their own login: no web services, no tokens, no admin.</Translate>
          </p>
          <div className={styles.buttons}>
            <Link className="button button--primary button--lg" to="/getting-started/installation">
              <Translate id="home.button.start">Get started</Translate>
            </Link>
            <Link className="button button--secondary button--lg" to="/areas/courses">
              <Translate id="home.button.areas">Moodle areas</Translate>
            </Link>
            <Link className="button button--secondary button--lg" to="/api">
              <Translate id="home.button.api">API reference</Translate>
            </Link>
          </div>
        </div>
      </header>
      <main className="container margin-vert--xl">
        <div className="row">
          {features().map((feature) => (
            <div key={feature.title} className="col col--4 margin-bottom--lg">
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </div>
          ))}
        </div>
        <div className="row margin-top--lg">
          <div className="col col--8 col--offset-2">
            <h2>
              <Translate id="home.example.title">Log in once, then work the site</Translate>
            </h2>
            <p>
              <Translate id="home.example.text">
                The person logs in by hand in a browser window, once; the session stays in a profile on disk. Every operation is a method of the Moodle object, takes ids and options, and returns plain data.
              </Translate>
            </p>
            <CodeBlock language="ts">{EXAMPLE}</CodeBlock>
          </div>
        </div>
      </main>
    </Layout>
  );
}
