import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import Reveal from "../../components/Reveal/Reveal.tsx";
import ScoreRing from "../../components/ScoreRing/ScoreRing.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { useCountUp } from "../../hooks/useCountUp.ts";
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

/** Typed into the demo terminal, then "evaluated". */
const TYPED_PROMPT =
  "Write a function two_sum(nums, target) that returns the indices of two numbers summing to the target.";

const STATUS_SEQUENCE = [
  "Generating code…",
  "Running tests…",
  "Scoring…",
  "Report ready",
];

const SAMPLE_TESTS = [
  { name: "two_sum_basic", passed: true },
  { name: "two_sum_duplicates", passed: true },
  { name: "two_sum_unsorted", passed: false },
];

/** Illustrative platform figures — labeled as sample data. */
const STATS: Array<{
  value: number;
  suffix: string;
  label: string;
  decimals?: number;
}> = [
  { value: 5, suffix: "", label: "Languages supported" },
  { value: 3, suffix: "s", label: "Avg. evaluation time", decimals: 0 },
  { value: 5, suffix: "", label: "Test runners" },
  { value: 3, suffix: "", label: "LLM providers" },
];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function Home() {
  const { user } = useAuth();
  const [typed, setTyped] = useState(prefersReducedMotion() ? TYPED_PROMPT : "");
  const [statusIndex, setStatusIndex] = useState(
    prefersReducedMotion() ? STATUS_SEQUENCE.length - 1 : 0,
  );

  // Typewriter: reveal the prompt char-by-char, then cycle status chips.
  useEffect(() => {
    if (prefersReducedMotion()) {
      setTyped(TYPED_PROMPT);
      setStatusIndex(STATUS_SEQUENCE.length - 1);
      return;
    }
    let char = 0;
    const typeTimer = window.setInterval(() => {
      char += 1;
      setTyped(TYPED_PROMPT.slice(0, char));
      if (char >= TYPED_PROMPT.length) {
        window.clearInterval(typeTimer);
      }
    }, 24);

    const statusTimer = window.setTimeout(() => {
      const statusId = window.setInterval(() => {
        setStatusIndex((index) =>
          index >= STATUS_SEQUENCE.length - 1 ? 0 : index + 1,
        );
      }, 1200);
      // Status cycling is a demo flourish; tie its lifetime to the component.
      window.setTimeout(() => window.clearInterval(statusId), 30000);
    }, TYPED_PROMPT.length * 24 + 400);

    return () => {
      window.clearInterval(typeTimer);
      window.clearTimeout(statusTimer);
    };
  }, []);

  return (
    <div>
      <section className={styles.hero}>
        <Reveal>
          <div className={styles.heroBadgeRow}>
            <Badge variant="primary">AI-powered code evaluation</Badge>
            <Badge variant="success">Open source prototype</Badge>
          </div>
        </Reveal>

        <Reveal delayMs={80}>
          <h1 className={styles.heroTitle}>
            Generate, execute, and evaluate AI-written code — automatically
          </h1>
        </Reveal>

        <Reveal delayMs={160}>
          <p className={styles.heroSubtitle}>
            Submit coding challenges, have LLMs write the solutions, and verify
            correctness with automated test suites in an isolated environment.
            All in one platform.
          </p>
        </Reveal>

        <Reveal delayMs={240}>
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
        </Reveal>

        {/* Animated terminal — the matrix-style input → process → result cycle */}
        <Reveal delayMs={320}>
          <div className={styles.animPanel}>
            <div className={styles.animHeader} aria-hidden="true">
              <span className={styles.animDots}>
                <i />
                <i />
                <i />
              </span>
              <span className={styles.animTitle}>evaluation · two_sum</span>
              <span className={styles.animStatus}>
                <span className={styles.animStatusDot} />
                {STATUS_SEQUENCE[statusIndex]}
              </span>
            </div>

            <div className={styles.animPrompt} aria-hidden="true">
              <span className={styles.animPromptLabel}>$</span>
              <span className={styles.animPromptText}>
                {typed}
                <span className={styles.animCaret} />
              </span>
            </div>

            {/* Sample report — the evaluation outcome at a glance */}
            <div
              className={styles.sampleReport}
              aria-label="Sample evaluation report"
            >
              <ScoreRing value={88} label="Sample score" animate />
              <div className={styles.sampleMeta}>
                <ul className={styles.sampleTests}>
                  {SAMPLE_TESTS.map((test) => (
                    <li
                      key={test.name}
                      className={
                        test.passed ? styles.sampleTestPass : styles.sampleTestFail
                      }
                    >
                      {test.passed ? "✓" : "✗"} {test.name}
                    </li>
                  ))}
                </ul>
                <div className={styles.sampleMetaRow}>
                  <span>3 tests · 142 ms · pytest</span>
                  <span className={styles.sampleMetaLink}>View report →</span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Animated pipeline */}
        <div className={styles.pipeline} aria-hidden="true">
          <div className={styles.pipelineTrack}>
            {PIPELINE.map((step, index) => (
              <div key={step.label} className={styles.pipelineGroup}>
                <div className={`${styles.pipelineStep} ${styles[`step${index}`]}`}>
                  <span className={styles.pipelineNum}>{index + 1}</span>
                  <span className={styles.pipelineIcon}>{step.icon}</span>
                  <span className={styles.pipelineLabel}>{step.label}</span>
                  <span className={styles.pipelineDesc}>{step.desc}</span>
                </div>
                {index < PIPELINE.length - 1 && (
                  <span
                    className={`${styles.pipelineConnector} ${styles[`arrow${index}`]}`}
                    aria-hidden="true"
                  />
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

        {/* Trust / stats strip — clearly labeled sample figures */}
        <div className={styles.statsStrip}>
          {STATS.map((stat) => (
            <StatItem key={stat.label} stat={stat} />
          ))}
        </div>
        <p className={styles.statsCaption}>Sample figures for the prototype</p>
      </section>

      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <Reveal>
          <h2 className={styles.sectionTitle}>
            Everything you need to evaluate code
          </h2>
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
        </Reveal>
      </section>

      <section className={styles.section}>
        <Reveal>
          <h2 className={styles.sectionTitle}>From challenge to score in four steps</h2>
          <p className={styles.sectionSubtitle}>
            A guided flow that takes you from idea to evaluation result.
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
        </Reveal>
      </section>

      {/* Guest teaser — routes guests to the live demo, members to their first run */}
      <section className={styles.section}>
        <Reveal>
          <div className="sectionHighlight teaser">
            <h2 className={styles.teaserTitle}>
              {user ? "Run your first evaluation" : "See a sample evaluation — no account needed"}
            </h2>
            <p className={styles.teaserText}>
              {user
                ? "Create a challenge and let the platform generate, execute, and score a solution in seconds."
                : "The live demo walks you through the full pipeline with a pre-built challenge and the free demo provider."}
            </p>
            <div className={styles.heroActions}>
              {user ? (
                <Link to="/challenges/new">
                  <Button size="lg">Create a challenge</Button>
                </Link>
              ) : (
                <Link to="/demo">
                  <Button size="lg">Try the live demo</Button>
                </Link>
              )}
            </div>
          </div>
        </Reveal>
      </section>

      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <Reveal>
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
        </Reveal>
      </section>
    </div>
  );
}

function StatItem({ stat }: { stat: (typeof STATS)[number] }) {
  const display = useCountUp(stat.value, 900, 200);
  const shown = stat.decimals ? display.toFixed(stat.decimals) : String(display);
  return (
    <div className={styles.statItem}>
      <span className={styles.statValue}>
        {shown}
        {stat.suffix}
      </span>
      <span className={styles.statLabel}>{stat.label}</span>
    </div>
  );
}

export default Home;