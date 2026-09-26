import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import Reveal from "../../components/Reveal/Reveal.tsx";
import ScoreRing from "../../components/ScoreRing/ScoreRing.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { useCountUp } from "../../hooks/useCountUp.ts";
import styles from "./Home.module.css";

const FEATURES = [
  {
    icon: "🤖",
    title: "Multi-provider LLM",
    text: "Generate solutions with OpenAI, Anthropic, Gemini, Groq, a local Ollama server, or a free built-in demo model — no API keys required for the demo provider.",
  },
  {
    icon: "🧪",
    title: "Automated test suites",
    text: "Every generated solution is run against your test suite, in the language you chose, inside a time-limited sandbox.",
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
    text: "Write a prompt for the AI and a test suite that defines correctness.",
  },
  {
    title: "Pick a provider",
    text: "Choose OpenAI, Anthropic, Gemini, Groq, a local Ollama server, or the free demo model to generate the solution.",
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
  { icon: "🤖", label: "Pick provider", desc: "6 providers · demo is free" },
  { icon: "⚙️", label: "AI generates code", desc: "Sandboxed" },
  { icon: "🧪", label: "Tests run", desc: "Your suite, isolated" },
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
  /** Which identity hue this stat wears. See `accentClass` below. */
  accent: "primary" | "teal" | "violet" | "rose";
}> = [
  // The two counts are read off the registries rather than eyeballed:
  // services/languages.py EXECUTABLE_LANGUAGES and services/llm.py _PROVIDERS.
  { value: 13, suffix: "", label: "Languages supported", accent: "primary" },
  { value: 3, suffix: "s", label: "Avg. evaluation time", decimals: 0, accent: "teal" },
  { value: 3, suffix: "", label: "Repair attempts", accent: "violet" },
  { value: 6, suffix: "", label: "LLM providers", accent: "rose" },
];

/**
 * Decorative code fragments drifting behind the hero.
 *
 * Purely atmospheric: they carry no product claim, so the whole list is
 * `aria-hidden` and removed from the a11y tree. Each entry supplies its own
 * position and animation delay, which is what stops a dozen fragments from
 * floating in lockstep. The list is deliberately shorter than the space it
 * occupies — the centre column carries the real content.
 */
const CODE_FRAGMENTS = [
  { text: "def two_sum(nums, target):", top: "14%", left: "4%", delay: "0s" },
  { text: "assert score >= 0.85", top: "26%", right: "6%", delay: "-3s" },
  { text: "pytest -q  →  2/3 passed", top: "52%", left: "3%", delay: "-6s" },
  { text: "sandbox.exec(lang=\"python\")", top: "60%", right: "4%", delay: "-9s" },
  { text: "openai · anthropic · local", top: "78%", left: "8%", delay: "-1.5s" },
  { text: "stream → eval → score", top: "84%", right: "9%", delay: "-7.5s" },
  { text: "[ok] 142ms", top: "38%", left: "11%", delay: "-11s" },
  { text: "eval#4207 · streaming", top: "8%", right: "18%", delay: "-5s" },
];

/** Toolchain chips — reinforce what the platform actually talks to. */
const STACK_CHIPS = [
  "OpenAI",
  "Anthropic",
  "pytest",
  "node --test",
  "JUnit",
  "go test",
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
        {/* Ambient layer: grid + colour blobs + drifting code. Decorative only,
            so it sits behind the content and never reaches the a11y tree. */}
        <div className={styles.heroBackdrop} aria-hidden="true">
          <div className="codeGrid" />
          <span className={styles.blobPrimary} />
          <span className={styles.blobAccent} />
          <span className={styles.blobSuccess} />
          {CODE_FRAGMENTS.map((fragment) => (
            <code
              key={fragment.text}
              className="codeFragment"
              style={{
                top: fragment.top,
                left: fragment.left,
                right: fragment.right,
                animationDelay: fragment.delay,
              }}
            >
              {fragment.text}
            </code>
          ))}
        </div>

        <div className={styles.heroInner}>
          <Reveal>
            <div className={styles.heroBadgeRow}>
              <Badge variant="primary">AI-powered code evaluation</Badge>
              <Badge variant="success">Open source prototype</Badge>
            </div>
          </Reveal>

          <Reveal delayMs={80}>
            <PageTitle variant="hero" size="lg" className={styles.heroTitle}>
              Generate, execute, and evaluate AI-written code — automatically
            </PageTitle>
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
                <Button size="lg" className={styles.ctaPrimary}>
                  See the demo
                </Button>
              </Link>
              <Link to="/register">
                <Button
                  variant="secondary"
                  size="lg"
                  className={styles.ctaSecondary}
                >
                  Get started free
                </Button>
              </Link>
            </div>
          </Reveal>

          {/* Toolchain chips — says what the platform actually talks to, which
              is the fastest way to make the offer concrete above the fold. */}
          <Reveal delayMs={300}>
            {/* Named as examples, not an exhaustive list: six chips standing in
                for thirteen languages and six providers. The chips are real
                information rather than decoration, so unlike the code fragments
                above they stay in the accessibility tree. */}
            <ul className={styles.chipRow} aria-label="Example integrations and test runners">
              {STACK_CHIPS.map((chip) => (
                <li key={chip} className={styles.chip}>
                  {chip}
                </li>
              ))}
            </ul>
          </Reveal>

          {/* Animated terminal — the matrix-style input → process → result cycle */}
          <Reveal delayMs={320}>
            <div className={styles.animPanel}>
              <span className={styles.panelGlow} aria-hidden="true" />
              <span className={styles.panelScan} aria-hidden="true" />
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
        </div>

        {/* Animated pipeline */}
        <div className={`${styles.heroInner} ${styles.pipeline}`} aria-hidden="true">
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
        <div className={`${styles.heroInner} ${styles.statsStrip}`}>
          {STATS.map((stat) => (
            <StatItem key={stat.label} stat={stat} />
          ))}
        </div>
        <p className={`${styles.heroInner} ${styles.statsCaption}`}>
          Sample figures for the prototype
        </p>
      </section>

      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <div className="scrollReveal">
          <SectionHead
            eyebrow="The pipeline"
            title="Everything you need to evaluate code"
            subtitle="A complete pipeline from challenge to scored result, built for AI coding assistants."
          />
        </div>
        <Reveal>
          <div className={styles.featuresGrid}>
            {FEATURES.map((feature) => (
              <Card key={feature.title} className={styles.featureCard}>
                <div className={styles.featureIcon} aria-hidden="true">
                  {feature.icon}
                </div>
                <h3 className={styles.featureTitle}>{feature.title}</h3>
                <p className={styles.featureText}>{feature.text}</p>
              </Card>
            ))}
          </div>
        </Reveal>
      </section>

      <section className={styles.section}>
        <div className="scrollReveal">
          <SectionHead
            eyebrow="How it works"
            title="From challenge to score in four steps"
            subtitle="A guided flow that takes you from idea to evaluation result."
          />
        </div>
        <Reveal>
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

/**
 * Section header with a monospace eyebrow label above the title.
 *
 * Exists so every section on the page announces itself the same way — the
 * eyebrow is the first thing a skimming reader lands on, and it keeps the
 * title from having to do all the orienting work alone.
 */
function SectionHead({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className={styles.sectionHead}>
      <p className={styles.sectionEyebrow}>
        <span className={styles.eyebrowDot} aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.sectionSubtitle}>{subtitle}</p>
    </header>
  );
}

function StatItem({ stat }: { stat: (typeof STATS)[number] }) {
  const display = useCountUp(stat.value, 900, 200);
  const shown = stat.decimals ? display.toFixed(stat.decimals) : String(display);
  return (
    // The accent is carried by a custom property rather than a class per hue,
    // so `.statItem`'s hover/tint rules are written once. The data attribute
    // also means the colour survives if this is ever server-rendered.
    <div className={styles.statItem} data-accent={stat.accent}>
      <span className={styles.statValue}>
        {shown}
        {stat.suffix}
      </span>
      <span className={styles.statLabel}>{stat.label}</span>
    </div>
  );
}

export default Home;