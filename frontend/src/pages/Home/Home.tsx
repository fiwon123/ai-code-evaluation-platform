import type { CSSProperties } from "react";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import Reveal from "../../components/Reveal/Reveal.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { useCountUp } from "../../hooks/useCountUp.ts";
import { useInView } from "../../hooks/useInView.ts";
import { scoreBand } from "../../utils/formatting.ts";
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

/**
 * The five pipeline steps, phrased alike on purpose (#353).
 *
 * The previous set mixed an imperative with descriptions — "Write challenge",
 * "AI generates code", "Get score" — so the labels ranged from 9 to 17
 * characters and wrapped to different line counts. The cards are equal-height
 * only if their content is, and the fifth card came out 27px taller than the
 * first four purely because of its wording. Every label is now a verb and its
 * object, 12-16 characters, which is what makes one cadence fit all five.
 */
const PIPELINE = [
  { icon: "📝", label: "Write a challenge", desc: "Prompt + tests" },
  { icon: "🤖", label: "Pick a provider", desc: "6 providers · demo is free" },
  { icon: "⚙️", label: "Generate code", desc: "Sandboxed execution" },
  { icon: "🧪", label: "Run your tests", desc: "Your suite, isolated" },
  { icon: "📊", label: "Get a score", desc: "Pass/fail + metrics" },
];

/** Typed into the demo terminal, then "evaluated". */

/**
 * The compact "here is what your first evaluation looks like" log (#355).
 *
 * Every line is read off the backend rather than written for effect, because
 * this is the same trap #352 walked into: the hero terminal once claimed a score
 * of 88 next to a visible failing test, when `services/evaluation.py` computes
 * `round((passed / total) * 100, 1)` and would have printed 66.7. A landing page
 * that shows a figure its own backend would not produce is lying about the
 * product, so each line here cites the thing it came from:
 *
 *   POST /api/challenges      `app/api/challenges.py` — `@router.post("")`
 *   POST /api/submissions     `app/api/submissions.py` — `@router.post("")`
 *   demo                      `_PROVIDERS` in `app/services/llm.py`: the free,
 *                             network-independent provider. Named as the provider
 *                             *key*, which is what an API caller passes.
 *   python                    one of `EXECUTABLE_LANGUAGES`,
 *                             `app/services/languages.py`
 *   66.7 · 142ms              the same sample run `AnimatedTerminal` plays, and
 *                             the same arithmetic: two of three tests pass, so
 *                             `round(2 / 3 * 100, 1)` is 66.7. Reusing the hero's
 *                             figures also means the page cannot contradict
 *                             itself two screens apart.
 *
 * Deliberately *not* a shell session. There is no CLI — `backend/pyproject.toml`
 * declares no `[project.scripts]` and nothing in `docs/` documents one — so a
 * `$ platform generate` prompt would be inventing a product surface. Framed as
 * the API calls the platform actually exposes, every line is a thing a reader
 * could check.
 *
 * The granularity is also the point: the hero types out one submission beat by
 * beat, and this summarises the whole run in five rows. A second character-level
 * terminal at the foot of the page would be the same animation twice.
 */
const TEASER_RUN: readonly {
  label?: string;
  detail?: string;
  /** Test outcomes, rendered as chips on their own row. */
  results?: readonly { name: string; passed: boolean }[];
  /** The row that carries the score, set apart from the log above it. */
  score?: boolean;
}[] = [
  { label: "POST /api/challenges", detail: "challenge#4821 · python · 3 tests" },
  { label: "POST /api/submissions", detail: "queued · provider demo" },
  { label: "evaluating", detail: "pytest · 3 tests" },
  {
    results: [
      { name: "two_sum_basic", passed: true },
      { name: "two_sum_unsorted", passed: false },
    ],
  },
  { label: "score", detail: "66.7 · 142ms", score: true },
];

/**
 * Milliseconds between one teaser row's entrance and the next.
 *
 * Supplied to the CSS as `--teaser-delay` rather than written into the
 * `animation-delay` calc there, so the stagger has one definition. The
 * `calc(var(--teaser-i) * 260ms)` shape would have worked, but then the number
 * lives in two files with nothing holding them together — and the two are the
 * kind of value that has to agree (see `TERMINAL_ENTRANCE_MS`, where a CSS/JS
 * disagreement cost a whole entrance).
 */
const TEASER_STAGGER_MS = 260;

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

/**
 * Card accent per step, keyed by the figure's own accent (#353).
 *
 * `Card` already takes a `--card-accent` custom property (#347), so the four
 * cards can be tinted from the single accent each step already declares rather
 * than a second list that could drift from `STEPS`. The values are `var(...)`
 * strings on purpose: the hue stays defined in tokens, so a theme swap does not
 * need this map touched.
 */
const STEP_ACCENTS: Record<(typeof STEPS)[number]["stat"]["accent"], string> = {
  primary: "var(--color-primary)",
  teal: "var(--color-accent-teal)",
  violet: "var(--color-accent-violet)",
  rose: "var(--color-accent-rose)",
};

function Home() {
  const { user } = useAuth();
  // One observer for the whole grid rather than one per card: the four values
  // must start on the same turn of the sweep anyway, so a shared gate is both
  // cheaper and the only way their stagger stays meaningful.
  const { ref: stepsRef, inView: stepsInView } = useInView<HTMLDivElement>({ threshold: 0.15 });
  // The teaser run log at the foot of the page (#355). Separate from the sweep
  // above because they are separate sections that arrive at separate times, and
  // one observer cannot gate two elements at different depths in the document.
  const { ref: teaserRef, inView: teaserInView } = useInView<HTMLDivElement>({ threshold: 0.2 });
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
          {/* `data-entered` drives the per-card entrance below. It is the same
              gate the stat sweep uses (#354), so the figures and the cards that
              explain them arrive together rather than one leading the other. */}
          <div
            className={styles.stepsGrid}
            ref={stepsRef}
            data-entered={stepsInView ? "true" : "false"}
          >
            {STEPS.map((step, index) => (
              <Card
                key={step.title}
                padding="compact"
                className={styles.stepCard}
                // A CSSProperties cast rather than a typed record: `--card-accent`
                // is a custom property, which TypeScript cannot express in
                // CSSProperties without listing every name.
                style={{ "--card-accent": STEP_ACCENTS[step.stat.accent] } as CSSProperties}
              >
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

      {/* Guest teaser — routes guests to the live demo, members to their first
          run. #355 gave it the compact run log below: the section used to be
          the only one on the page with a heading, a sentence and a button and
          nothing else, so the page went flat for its last two screens.

          `data-entered` gates the rows the same way the step cards' entrance is
          gated (#353) and for the same reason: the reveal runs once, when the
          section arrives, rather than on mount — an animation at the foot of the
          page that finishes before anyone scrolls to it is one nobody watched.
          `useInView` reports visible immediately under reduced motion and
          without IntersectionObserver, so the rows are never withheld from
          someone who will not see the animation anyway. */}
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

            {/* `aria-hidden`: it restates the sentence above in a form the
                button already leads to, and a screen reader announcing a fake
                log line by line is worse than not announcing it. */}
            <div
              className={styles.teaserPanelWrap}
              ref={teaserRef}
              data-entered={teaserInView ? "true" : "false"}
              aria-hidden="true"
            >
              <div className={styles.teaserPanel}>
                {TEASER_RUN.map((row, index) => (
                  <div
                    key={row.label ?? `row-${index}`}
                    className={row.score ? styles.teaserScoreRow : styles.teaserRow}
                    style={
                      {
                        "--teaser-delay": `${index * TEASER_STAGGER_MS}ms`,
                      } as CSSProperties
                    }
                  >
                    {row.results ? (
                      <span className={styles.teaserResults}>
                        {row.results.map((result) => (
                          <span
                            key={result.name}
                            className={result.passed ? styles.teaserPass : styles.teaserFail}
                          >
                            <span aria-hidden="true">{result.passed ? "✓" : "✗"}</span>
                            {result.name}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <>
                        {row.label && <span className={styles.teaserLabel}>{row.label}</span>}
                        {row.detail &&                        <span
                          className={styles.teaserDetail}
                          style={
                            row.score
                              ? ({ "--score-band": scoreBand(66.7) } as CSSProperties)
                              : undefined
                          }
                        >
                          {row.detail}
                        </span>}
                      </>
                    )}
                  </div>
                ))}
              </div>
              <p className={styles.teaserPanelCaption}>
                Sample run on the free demo provider — your own challenge, tests
                and score
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <Reveal>
          <div className={styles.cta}>
            {/* The page's closing motif (#355): a faint ring sweeping once
                around the banner, echoing the score ring in the hero terminal
                that the reader met at the top. Decorative and pointer-inert, so
                it never affects layout or hit-testing. */}
            <span className={styles.ctaRing} aria-hidden="true" />
            <span className={styles.ctaAura} aria-hidden="true" />
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
    <div className={styles.sectionHead}>
      <p className={styles.sectionEyebrow}>
        <span className={styles.eyebrowDot} aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.sectionSubtitle}>{subtitle}</p>
    </div>
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