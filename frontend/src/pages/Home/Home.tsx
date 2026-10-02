import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import Reveal from "../../components/Reveal/Reveal.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { useCountUp } from "../../hooks/useCountUp.ts";
import { useInView } from "../../hooks/useInView.ts";
import AnimatedTerminal from "./AnimatedTerminal";
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

/**
 * The four steps, each carrying the one number that supports it.
 *
 * The stats used to live in their own strip below the hero, captioned "Sample
 * figures for the prototype" — a caption that undercut the page and, worse, was
 * the only thing marking two of the four as illustrative. Folded into the step
 * that explains them, a number has to earn its place in the sentence beside it.
 *
 * That is also what makes the caption safe to delete (#354): all four are read
 * off the code rather than eyeballed, and each one is a property of the step it
 * sits in, so nothing is left claiming a figure the backend would not produce.
 *
 *   13  `EXECUTABLE_LANGUAGES`, `app/services/languages.py`
 *    6  `_PROVIDERS`, `app/services/llm.py`
 *    3  `evaluation_max_attempts`, `app/config.py` — total generate-and-test
 *       attempts, so attempt 1 plus two repairs. The old strip said "repair
 *       attempts: 3", which overstated the repair loop by one.
 *   64  `docker_max_output_bytes` / 1024, `app/config.py` — the cap on captured
 *       logs, which is what "review results" is bounded by.
 *
 * The accents keep the original left-to-right order (primary, teal, violet,
 * rose) even though the numbers moved, so the page's colour rhythm is unchanged.
 */
const STEPS = [
  {
    title: "Create a challenge",
    text: "Write a prompt for the AI and a test suite that defines correctness.",
    stat: {
      value: 13,
      suffix: "",
      label: "languages supported",
      accent: "primary",
    },
  },
  {
    title: "Pick a provider",
    // Two lines, like its three neighbours. This was the only card running to
    // three, which left the other three with a line of dead space once the grid
    // stretched them all to match — and re-listing all six providers is now
    // redundant anyway, since the figure above it says how many there are.
    text: "Choose OpenAI, Anthropic, Gemini, Groq, Ollama, or the free demo model.",
    stat: { value: 6, suffix: "", label: "LLM providers", accent: "teal" },
  },
  {
    title: "Generate & evaluate",
    text: "The platform generates code and runs your tests against it automatically.",
    stat: {
      value: 3,
      suffix: "",
      label: "attempts per submission",
      accent: "violet",
    },
  },
  {
    title: "Review results",
    text: "Inspect generated code, test outcomes, logs, and scores in a clean report.",
    stat: {
      value: 64,
      suffix: " KB",
      label: "of logs captured",
      accent: "rose",
    },
  },
];

/**
 * The count-up sweep.
 *
 * The four values used to all start at the same 200ms delay, so they grew
 * together and the section had no direction — four numbers reaching their
 * targets at once reads as a flicker, not an animation. A sweep that finishes
 * left to right gives the eye something to follow and an unambiguous end.
 *
 * `STAT_DURATION + STAT_GAP` is the stride between one value's start and the
 * next's, and the gap is a real gap: the next value must not begin before the
 * previous has settled, or the two overlap and the sweep is just a stagger with
 * extra steps. The last value therefore settles at
 * `START + 3 * (DURATION + GAP) + DURATION`.
 *
 * These three numbers are asserted in `landing.test.tsx`, because the failure
 * this replaces is invisible in a screenshot — four numbers that all reach the
 * right value look identical whether they arrived together or one at a time.
 */
const STAT_DURATION_MS = 900;
const STAT_GAP_MS = 200;
const STAT_START_MS = 150;

/** When the value in position `index` starts, given the sweep constants. */
function statStartMs(index: number): number {
  return STAT_START_MS + index * (STAT_DURATION_MS + STAT_GAP_MS);
}

const PIPELINE = [
  { icon: "📝", label: "Write challenge", desc: "Prompt + tests" },
  { icon: "🤖", label: "Pick provider", desc: "6 providers · demo is free" },
  { icon: "⚙️", label: "AI generates code", desc: "Sandboxed" },
  { icon: "🧪", label: "Tests run", desc: "Your suite, isolated" },
  { icon: "📊", label: "Get score", desc: "Pass/fail + metrics" },
];

/** Typed into the demo terminal, then "evaluated". */

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

function Home() {
  const { user } = useAuth();
  // One observer for the whole grid rather than one per card: the four values
  // must start on the same turn of the sweep anyway, so a shared gate is both
  // cheaper and the only way their stagger stays meaningful.
  const { ref: stepsRef, inView: stepsInView } = useInView<HTMLDivElement>({ threshold: 0.15 });
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
              <Button
                to="/demo"
                size="lg"
                className={styles.ctaPrimary}
              >
                See the demo
              </Button>
              <Button
                to="/register"
                variant="secondary"
                size="lg"
                className={styles.ctaSecondary}
              >
                Get started free
              </Button>
            </div>
          </Reveal>

          {/* The terminal story lives in its own component: it re-renders once
              per typed character, and at ~18ms a frame that is only affordable
              if the rest of the page is not re-rendering with it. See
              AnimatedTerminal for the measurement that forced the split.

              Not wrapped in `Reveal`: the panel fades in itself, because it also
              has to know when the fade finished so the story can wait for it.
              See `TERMINAL_ENTRANCE_MS` in AnimatedTerminal. Same 320ms stagger
              and 550ms fade, so the hero still arrives as one piece. */}
          <AnimatedTerminal />
        </div>
      </section>

      {/* How it works — directly under the terminal it explains (#354). The
          page used to read terminal → pipeline → stats → how-it-works, which
          put the section that narrates the flow two screens away from the
          animation that performs it. */}
      <section className={styles.section}>
        <div className="scrollReveal">
          <SectionHead
            eyebrow="How it works"
            title="From challenge to score in four steps"
            subtitle="A guided flow that takes you from idea to evaluation result."
          />
        </div>
        <Reveal>
          <div className={styles.stepsGrid} ref={stepsRef}>
            {STEPS.map((step, index) => (
              <Card key={step.title} padding="compact">
                <div className={styles.stepNumber}>{index + 1}</div>
                <StatValue stat={step.stat} index={index} active={stepsInView} />
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepText}>{step.text}</p>
              </Card>
            ))}
          </div>
        </Reveal>
      </section>

      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <div className="scrollReveal">
          <SectionHead
            eyebrow="The pipeline"
            title="Everything you need to evaluate code"
            subtitle="A complete pipeline from challenge to scored result, built for AI coding assistants."
          />
        </div>

        {/* The animated 5-step strip, which used to sit inside the hero between
            the terminal and the stats. It describes this section rather than
            the hero, and the hero read better ending on the terminal. */}
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
                <Button to="/challenges/new" size="lg">Create a challenge</Button>
              ) : (
                <Button to="/demo" size="lg">Try the live demo</Button>
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
              <Button to="/register" size="lg">Create free account</Button>
              <Button
                to="/features"
                variant="secondary"
                size="lg"
              >
                Explore features
              </Button>
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

/**
 * One step's number, counting up on its own turn of the sweep.
 *
 * `index` is the only new input, and it is what turns four simultaneous count-ups
 * into a left-to-right sweep. `useCountUp` takes a start delay rather than a
 * start time, so the delay is derived from the stride — see `statStartMs`.
 */
function StatValue({
  stat,
  index,
  active,
}: {
  stat: (typeof STEPS)[number]["stat"];
  index: number;
  active: boolean;
}) {
  // `null` while the section is off-screen: the sweep waits for the viewport
  // instead of counting up where nobody can see it.
  const display = useCountUp(
    stat.value,
    STAT_DURATION_MS,
    active ? statStartMs(index) : null,
  );
  return (
    // The accent is carried by a custom property rather than a class per hue,
    // so `.stepStat`'s rules are written once. The data attribute also means the
    // colour survives if this is ever server-rendered.
    //
    // `data-counting` is what the sweep test and the CSS read: it is the only
    // place that says "this value is still moving", and it flips off exactly
    // when `useCountUp` settles, so a static screenshot can tell a finished
    // sweep from an unfinished one.
    <div className={styles.stepStat} data-accent={stat.accent}>
      <span className={styles.stepStatValue} data-counting={stat.value === display ? "false" : "true"}>
        {display}
        {stat.suffix}
      </span>
      <span className={styles.stepStatLabel}>{stat.label}</span>
    </div>
  );
}

export default Home;