import AmbientBackdrop from "../../components/AmbientBackdrop/AmbientBackdrop.tsx";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import { Link } from "react-router-dom";
import styles from "./Features.module.css";

const PIPELINE = [
  { icon: "📝", label: "Write", desc: "Prompt + tests" },
  { icon: "🤖", label: "Pick", desc: "6 providers · demo is free" },
  { icon: "⚙️", label: "Generate", desc: "LLM writes code" },
  { icon: "🧪", label: "Run", desc: "Your suite, sandboxed" },
  { icon: "📊", label: "Score", desc: "Pass/fail + report" },
];

const FEATURES = [
  {
    icon: "multi",
    title: "Multi-provider code generation",
    text: "Run each challenge across OpenAI, Anthropic, Gemini, Groq, a local Ollama server, or the free demo provider — provider is chosen per submission.",
    checkmarks: [
      "OpenAI, Anthropic + Gemini integrations",
      "Free demo provider and local Ollama — no API keys required",
      "Provider picked at submission time",
    ],
  },
  {
    icon: "pytest",
    title: "Test suites defined per challenge",
    text: "Every challenge ships its own suite, written in the language you are evaluating, and run against the generated solution with a per-run timeout.",
    checkmarks: [
      "13 languages: Python, JS/TS, Java, Go, C, C++, Rust, PHP, Ruby, Perl, Kotlin, Lua",
      "Dedicated runner per language (pytest, node --test, JUnit, go test)",
      "Isolated temp workspace per evaluation",
    ],
  },
  {
    icon: "sandbox",
    title: "Sandboxed execution",
    text: "Generated code runs in a short-lived, resource-limited container with no network access, so a runaway solution is contained rather than trusted.",
    checkmarks: [
      "CPU, memory and wall-clock limits per run",
      "No network access while the tests run",
      "stdout/stderr captured per run",
    ],
  },
  {
    icon: "report",
    title: "Score & evaluation report",
    text: "Each evaluation produces a score, pass/fail breakdown, execution logs, and the generated source — one complete report.",
    checkmarks: [
      "Passed/total + normalized score",
      "Execution logs for every run",
      "Generated source included in report",
    ],
  },
];

/* ---- Mini UI mockups that convey each feature at a glance ---- */

function ProviderMockup() {
  return (
    <div className={styles.mockup} aria-hidden="true">
      <div className={styles.mockTitle}>LLM provider</div>
      <div className={`${styles.providerRow} ${styles.providerSelected}`}>
        <span className={styles.radio} /> Demo
        <span className={styles.providerBadge}>free · no key</span>
        <span className={styles.checkDot}>✓</span>
      </div>
      <div className={styles.providerRow}>
        <span className={styles.radio} /> OpenAI
        <span className={styles.providerSub}>gpt-4o-mini</span>
      </div>
      <div className={styles.providerRow}>
        <span className={styles.radio} /> Anthropic
        <span className={styles.providerSub}>claude-3-5-haiku</span>
      </div>
    </div>
  );
}

function EditorMockup() {
  return (
    <div className={styles.mockup} aria-hidden="true">
      <div className={styles.editorBar}>
        <span className={styles.editorDot} />
        <span className={styles.editorDot} />
        <span className={styles.editorDot} />
        <span className={styles.editorFile}>solution.py</span>
      </div>
      <div className={styles.code}>
        <div className={styles.codeLine}>
          <span className={styles.codeKw}>def</span>{" "}
          <span className={styles.codeFn}>two_sum</span>(nums, target):
        </div>
        <div className={styles.codeLine}>
          <span className={styles.codeKw}>for</span> i <span className={styles.codeKw}>in</span>{" "}
          range(len(nums)):
        </div>
        <div className={styles.codeLine}>
          <span className={styles.codeKw}>break</span>{" "}
        </div>
        <div className={styles.codeLine}>
          <span className={styles.codeKw}>return</span> [i, j]
        </div>
      </div>
    </div>
  );
}

function TerminalMockup() {
  return (
    <div className={styles.mockup} aria-hidden="true">
      <div className={styles.terminal}>
        <div className={styles.codeLine}>
          <span className={styles.codePrompt}>$</span> uv run pytest
        </div>
        <div className={styles.codeLine}>
          <span className={styles.testPass}>✓</span> two_sum_basic passed
        </div>
        <div className={styles.codeLine}>
          <span className={styles.testPass}>✓</span> two_sum_duplicates passed
        </div>
        <div className={styles.codeLine}>
          <span className={styles.testFail}>✗</span> two_sum_unsorted failed
        </div>
        <div className={styles.codeLine}>
          <span className={styles.codeResult}>2 passed, 1 failed</span>
        </div>
      </div>
    </div>
  );
}

function ReportMockup() {
  return (
    <div className={styles.mockup} aria-hidden="true">
      <div className={styles.reportHead}>
        <div className={styles.reportScore}>88</div>
        <div className={styles.reportHeadMeta}>
          <div className={styles.reportScoreLabel}>Evaluation score</div>
          <div className={styles.reportMeta}>3 tests · 142 ms · pytest</div>
        </div>
      </div>
      <ul className={styles.reportList}>
        <li className={`${styles.reportItem} ${styles.reportItemOk}`}>
          <span className={styles.reportMark}>✓</span> two_sum_basic
        </li>
        <li className={`${styles.reportItem} ${styles.reportItemOk}`}>
          <span className={styles.reportMark}>✓</span> two_sum_duplicates
        </li>
        <li className={`${styles.reportItem} ${styles.reportItemBad}`}>
          <span className={styles.reportMark}>✗</span> two_sum_unsorted
        </li>
      </ul>
    </div>
  );
}

const MOCKUPS: Record<string, () => React.JSX.Element> = {
  multi: ProviderMockup,
  pytest: EditorMockup,
  sandbox: TerminalMockup,
  report: ReportMockup,
};

function Features() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <AmbientBackdrop />
        <span className="eyebrow">Features</span>
        <PageTitle size="lg" className={styles.title}>Features</PageTitle>
        <p className={styles.subtitle}>
          A complete, production-shaped evaluation pipeline — write challenges,
          choose a provider, have an LLM generate the solution, and verify it
          automatically with grader-defined test suites.
        </p>
      </header>

      <section className={styles.pipeline} aria-label="Evaluation pipeline">
        {PIPELINE.map((step, index) => (
          <div className={styles.pipelineStep} key={step.label}>
            <div className={styles.pipelineNum}>{index + 1}</div>
            <div className={styles.pipelineIcon}>{step.icon}</div>
            <div className={styles.pipelineName}>{step.label}</div>
            <div className={styles.pipelineDesc}>{step.desc}</div>
          </div>
        ))}
      </section>

      <section className={styles.features}>
        {FEATURES.map((feature, index) => {
          const Mockup = MOCKUPS[feature.icon];
          return (
            <div
              className={`${styles.featureRow} ${
                index % 2 === 0 ? styles.featureRowEven : styles.featureRowOdd
              }`}
              key={feature.icon}
            >
              <div className={styles.visual}>
                <Mockup />
              </div>
              <div className={styles.content}>
                <h2 className={styles.featureTitle}>{feature.title}</h2>
                <p className={styles.featureText}>{feature.text}</p>
                <ul className={styles.list}>
                  {feature.checkmarks.map((item) => (
                    <li className={styles.listItem} key={item}>
                      <span className={styles.check}>✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </section>

      <section className={styles.cta}>
        <h2 className={styles.ctaTitle}>Ready to build one?</h2>
        <p className={styles.ctaText}>
          Create an account, write your first challenge, and watch the platform
          generate and evaluate a solution in seconds.
        </p>
        <Link className={styles.ctaLink} to="/register">
          Get started free
        </Link>
      </section>
    </div>
  );
}

export default Features;