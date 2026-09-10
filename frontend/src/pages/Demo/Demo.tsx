import { Link } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import styles from "./Demo.module.css";

const STEPS = [
  {
    icon: "📝",
    title: "Create a challenge",
    text: "Define an LLM prompt and a pytest test suite. Example: 'Write a function that returns the sum of a list.' with a few assertion tests.",
  },
  {
    icon: "🤖",
    title: "Submit for evaluation",
    text: "Pick a provider — OpenAI, Anthropic, or the free demo model — and submit. The platform records your submission and kicks off generation.",
  },
  {
    icon: "⚙️",
    title: "Code is generated & tested",
    text: "The LLM writes a solution, which is written to an isolated temp workspace and executed against the challenge's test suite with a strict timeout.",
  },
  {
    icon: "📊",
    title: "Review the report",
    text: "See the generated code, passed/total test counts, a score, and the full execution logs — all in a single evaluation report.",
  },
];

function Demo() {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>See how it works</h1>
      <p className={styles.pageSubtitle}>
        A guided walkthrough of the evaluation pipeline, plus a live demo you
        can try right now.
      </p>

      <div className={styles.walkthrough}>
        {STEPS.map((step) => (
          <div className={styles.step} key={step.title}>
            <div className={styles.stepIcon}>{step.icon}</div>
            <div>
              <h2 className={styles.stepTitle}>{step.title}</h2>
              <p className={styles.stepText}>{step.text}</p>
            </div>
          </div>
        ))}
      </div>

      <section className={styles.liveSection}>
        <Badge variant="primary">Live demo</Badge>
        <h2 className={styles.liveTitle}>Try it live</h2>
        <p className={styles.liveText}>
          Create a free account, open the challenges page, and submit any
          challenge with the <strong>demo provider</strong> — no API keys
          needed. The platform generates and evaluates a solution in seconds.
        </p>
        <div className={styles.liveActions}>
          <Link to="/register">
            <Button size="lg">Create account</Button>
          </Link>
          <Link to="/challenges">
            <Button variant="secondary" size="lg">
              Browse challenges
            </Button>
          </Link>
        </div>
        <p className={styles.liveHint}>
          Tip: use the demo provider for zero-cost, instant evaluations.
        </p>
      </section>
    </div>
  );
}

export default Demo;