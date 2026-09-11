import { Link } from "react-router-dom";
import styles from "./Features.module.css";

const PIPELINE = [
  { icon: "📝", label: "Write", desc: "Prompt + tests" },
  { icon: "🤖", label: "Pick", desc: "OpenAI · Anthropic · Demo" },
  { icon: "⚙️", label: "Generate", desc: "LLM writes code" },
  { icon: "🧪", label: "Run", desc: "pytest in sandbox" },
  { icon: "📊", label: "Score", desc: "Pass/fail + report" },
];

const FEATURES = [
  {
    icon: "multi",
    title: "Multi-provider code generation",
    text: "Run each challenge across OpenAI, Anthropic, or the free demo provider — provider is chosen per submission.",
    checkmarks: [
      "OpenAI + Anthropic integrations",
      "Free demo provider — no API keys required",
      "Provider picked at submission time",
    ],
  },
  {
    icon: "pytest",
    title: "pytest test suites defined per challenge",
    text: "Every challenge ships its own pytest suite that runs against the generated solution in an isolated subprocess.",
    checkmarks: [
      "Test suites defined per challenge",
      "Subprocess runner with per-run timeout",
      "Isolated temp workspace per evaluation",
    ],
  },
  {
    icon: "sandbox",
    title: "Sandboxed execution",
    text: "Generated code runs isolated from the host with strict timeouts, so a runaway solution can never harm the server.",
    checkmarks: [
      "Isolated execution environment",
      "Strict per-run timeout",
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

function Features() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Features</h1>
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
        {FEATURES.map((feature, index) => (
          <div
            className={`${styles.featureRow} ${
              index % 2 === 0 ? styles.featureRowEven : styles.featureRowOdd
            }`}
            key={feature.icon}
          >
            <div className={styles.visual}>
              <div className={`${styles.visualIcon} ${styles[feature.icon]}`} />
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
        ))}
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
