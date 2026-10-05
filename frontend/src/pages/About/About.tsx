import Card from "../../components/Card/Card.tsx";
import PageHeader from "../../components/PageHeader/PageHeader.tsx";
import styles from "./About.module.css";

const STACK = [
  "React 19",
  "TypeScript",
  "Vite",
  "FastAPI",
  "Python 3.14",
  "PostgreSQL",
  "Redis",
  "Celery",
  "Docker",
];

function About() {
  return (
    <div className={styles.page}>
      <PageHeader
        tone="marketing"
        eyebrow="About"
        title="About this project"
        subtitle="An open-source platform for automatically verifying AI-generated code."
      />

      <div className={styles.grid}>
        <Card>
          <h2 className={styles.sectionTitle}>Mission</h2>
          <p className={styles.text}>
            As AI coding assistants generate more and more code, developers
            need a reliable way to automatically verify correctness, identify
            failures, and compare solution quality. Manual review is slow,
            inconsistent, and doesn't scale.
          </p>
          <p className={styles.text}>
            This platform accepts coding challenges, generates solutions with
            multiple LLM providers, executes them safely in isolation, runs
            automated test suites, and produces evaluation scores — so teams
            can trust AI-generated code at speed.
          </p>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Technology stack</h2>
          <ul className={styles.stack}>
            {STACK.map((tech) => (
              <li className={styles.tech} key={tech}>
                {tech}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>How it works</h2>
          <p className={styles.text}>
            Users create challenges consisting of an LLM prompt and a test
            suite in the language they want evaluated. Submissions are queued
            through Redis and processed by a Celery worker, which calls the
            selected LLM provider, writes the generated code to an isolated
            workspace, runs the tests with a timeout, and stores the results.
          </p>
          <p className={styles.text}>
            Every evaluation records pass/fail counts, a score, execution logs,
            and metrics — all queryable through the API and UI.
          </p>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Project status</h2>
          <p className={styles.text}>
            This is an active open-source prototype. The core evaluation
            pipeline, authentication, challenge management, Docker sandbox
            execution, self-hosting, thirteen language runtimes, and a free
            demo provider are functional. Billing, multi-factor
            authentication, and self-service account management are on the
            roadmap.
          </p>
        </Card>
      </div>
    </div>
  );
}

export default About;