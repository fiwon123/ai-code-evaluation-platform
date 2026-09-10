import Card from "../../components/Card/Card.tsx";
import styles from "./Features.module.css";

const FEATURES = [
  {
    icon: "🤖",
    list: [
      "OpenAI provider for GPT-class code generation",
      "Anthropic provider for Claude-class generation",
      "Free demo provider — deterministic, no API key needed",
      "Provider selectable per submission",
    ],
  },
  {
    icon: "🧪",
    list: [
      "pytest test suites defined per challenge",
      "Subprocess execution with configurable timeout",
      "Isolated temp workspace per submission under /tmp/evaluations",
      "Captured stdout/stderr for debugging",
    ],
  },
  {
    icon: "🔐",
    list: [
      "JWT-based authentication with bcrypt password hashing",
      "Challenge ownership: create, update, delete your own",
      "Owner-only submission access",
      "Sandboxed execution for generated code",
    ],
  },
  {
    icon: "📊",
    list: [
      "Passed/total test counts per evaluation",
      "Normalized 0–100 score",
      "Execution logs for every run",
      "Metrics stored as JSON for future insight",
    ],
  },
];

const PIPELINE = [
  "Challenge",
  "Submission",
  "LLM generation",
  "Test execution",
  "Score & report",
];

function Features() {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Features</h1>
      <p className={styles.pageSubtitle}>
        A complete, production-shaped evaluation pipeline for AI-generated code.
      </p>

      <div className={styles.pipeline}>
        {PIPELINE.map((step, index) => (
          <div className={styles.pipelineStep} key={step}>
            <div className={styles.pipelineNum}>{index + 1}</div>
            <div className={styles.pipelineName}>{step}</div>
          </div>
        ))}
      </div>

      {FEATURES.map((feature) => (
        <div className={styles.featureRow} key={feature.icon}>
          <Card>
            <div className={styles.icon}>{feature.icon}</div>
            <ul className={styles.list}>
              {feature.list.map((item) => (
                <li className={styles.listItem} key={item}>
                  <span className={styles.check}>✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ))}
    </div>
  );
}

export default Features;