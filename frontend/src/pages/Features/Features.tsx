import styles from "./Features.module.css";

const PIPELINE = [
  "Challenge",
  "Submission",
  "LLM generation",
  "Test execution",
  "Score & report",
];

type Feature = {
  icon: string;
  title: string;
  text: string;
  checkmarks: string[];
};

const FEATURES: Feature[] = [
  {
    icon: "🤖",
    title: "Multi-provider code generation",
    text: "Run the same challenge against OpenAI, Anthropic, or the free demo model — provider choice is recorded per submission.",
    checkmarks: [
      "OpenAI and Anthropic integrations",
      "Free demo provider with no API key needed",
      "Provider selectable per submission",
    ],
  },
  {
    icon: "🧪",
    title: "Isolated, pytest-driven evaluation",
    text: "Every solution runs against a per-challenge pytest suite inside a sandboxed workspace, so tests are reproducible and safe.",
    checkmarks: [
      "pytest test suites defined per challenge",
      "Subprocess execution with a strict timeout",
      "Captured stdout/stderr for every run",
    ],
  },
  {
    icon: "🔐",
    title: "Secure by default",
    text: "Generated code and submissions are fully isolated — auth-scoped, ownership-checked, and executed in ephemeral sandboxes.",
    checkmarks: [
      "JWT authentication with bcrypt hashing",
      "Owner-only access to challenges and submissions",
      "Sandboxed execution for generated code",
    ],
  },
  {
    icon: "📊",
    title: "Detailed evaluation reports",
    text: "Every run produces a score, pass/fail counts, execution logs, and the generated source — all in one report.",
    checkmarks: [
      "Passed/total score per evaluation",
      "Normalized 0–100 score",
      "Full logs and generated code in each report",
    ],
  },
];

function Features() {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Features</h1>
      <p className={styles.pageSubtitle}>
        A production-shaped evaluation pipeline: write challenges, generate
        code with any provider, and get a scored, tested result — no manual
        review needed.
      </p>

      <div className={styles.pipeline}>
        {PIPELINE.map((step, index) => (
          <div className={styles.pipelineStep} key={step}>
            <div className={styles.pipelineNum}>{index + 1}</div>
            <div className={styles.pipelineName}>{step}</div>
          </div>
        ))}
      </div>

      {FEATURES.map((feature, index) => (
        <div
          className={`${styles.featureRow} ${
            index % 2 === 1 ? styles.featureRowReverse : ""
          }`}
          key={feature.icon}
        >
          <div className={styles.visual} aria-hidden="true">
            <span className={styles.visualIcon}>{feature.icon}</span>
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
    </div>
  );
}

export default Features;
