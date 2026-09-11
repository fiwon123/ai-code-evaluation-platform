import { Link } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import styles from "./Home.module.css";

const FEATURES = [
  {
    icon: "🤖",
    title: "Multi-provider LLM",
    text: "Generate solutions with OpenAI, Anthropic, or a free built-in demo model — no API keys required for the demo provider.",
  },
  {
    icon: "🧪",
    title: "Automated test suites",
    text: "Every generated solution is run against your pytest test suite in an isolated, time-limited process.",
  },
  {
    icon: "📊",
    title: "Evaluation scores",
    text: "Get pass/fail counts, scores, execution logs, and performance metrics for every submission.",
  },
];

const STEPS = [
  {
    title: "Create a challenge",
    text: "Write a prompt for the AI and a pytest test suite that defines correctness.",
  },
  {
    title: "Pick a provider",
    text: "Choose OpenAI, Anthropic, or the free demo model to generate the solution.",
  },
  {
    title: "Generate & evaluate",
    text: "The platform generates code and runs your tests against it automatically.",
  },
  {
    title: "Review results",
    text: "Inspect generated code, test outcomes, logs, and scores in a clean report.",
  },
];

const PIPELINE = [
  { icon: "📝", label: "Write challenge", desc: "Prompt + tests" },
  { icon: "🤖", label: "Pick provider", desc: "OpenAI · Anthropic · Demo" },
  { icon: "⚙️", label: "AI generates code", desc: "Sandboxed" },
  { icon: "🧪", label: "Tests run", desc: "pytest in isolation" },
  { icon: "📊", label: "Get score", desc: "Pass/fail + metrics" },
];

function Home() {
  return (
    <div>
      <section className={styles.hero}>
        <div className={styles.heroBadgeRow}>
          <Badge variant="primary">AI-powered code evaluation</Badge>
          <Badge variant="success">Open source prototype</Badge>
        </div>
        <h1 className={styles.heroTitle}>
          Generate, execute, and evaluate AI-written code — automatically
        </h1>
        <p className={styles.heroSubtitle}>
          Submit coding challenges, have LLMs write the solutions, and verify
          correctness with automated test suites in an isolated environment.
          All in one platform.
        </p>
        <div className={styles.heroActions}>
          <Link to="/demo">
            <Button size="lg">See the demo</Button>
          </Link>
          <Link to="/register">
            <Button variant="secondary" size="lg">
              Get started free
            </Button>
          </Link>
        </div>

        {/* Animated pipeline */}
        <div className={styles.pipeline} aria-hidden="true">
          <div className={styles.pipelineTrack}>
            {PIPELINE.map((step, index) => (
              <div key={step.label} className={styles.pipelineGroup}>
                <div className={`${styles.pipelineStep} ${styles[`step${index}`]}`}>
                  <span className={styles.pipelineIcon}>{step.icon}</span>
                  <span className={styles.pipelineLabel}>{step.label}</span>
                  <span className={styles.pipelineDesc}>{step.desc}</span>
                </div>
                {index < PIPELINE.length - 1 && (
                  <span className={`${styles.pipelineArrow} ${styles[`arrow${index}`]}`}>
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} />
          </div>
          <p className={styles.pipelineCaption}>
            From challenge to scored result in seconds
          </p>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Everything you need to evaluate code</h2>
        <p className={styles.sectionSubtitle}>
          A complete pipeline from challenge to scored result, built for AI
          coding assistants.
        </p>
        <div className={styles.featuresGrid}>
          {FEATURES.map((feature) => (
            <Card key={feature.title} className={styles.featureCard}>
              <div className={styles.featureIcon}>{feature.icon}</div>
              <h3 className={styles.featureTitle}>{feature.title}</h3>
              <p className={styles.featureText}>{feature.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How it works</h2>
        <p className={styles.sectionSubtitle}>
          From challenge to evaluation result in four simple steps.
        </p>
        <div className={styles.stepsGrid}>
          {STEPS.map((step, index) => (
            <Card key={step.title} padding="compact">
              <div className={styles.stepNumber}>{index + 1}</div>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepText}>{step.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.cta}>
          <h2 className={styles.ctaTitle}>Ready to try it?</h2>
          <p className={styles.ctaText}>
            Create an account, write your first challenge, and watch the
            platform generate and evaluate a solution in seconds.
          </p>
          <div className={styles.heroActions}>
            <Link to="/register">
              <Button size="lg">Create free account</Button>
            </Link>
            <Link to="/features">
              <Button variant="secondary" size="lg">
                Explore features
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Home;