import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import styles from "./Pricing.module.css";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    description: "For developers trying out AI code evaluation.",
    features: [
      "50 evaluations per month",
      "Demo LLM provider included",
      "Public challenges",
      "Community support",
    ],
    cta: "Start free",
    to: "/register",
    featured: false,
  },
  {
    name: "Pro",
    price: "$29",
    description: "For teams that evaluate code daily.",
    features: [
      "Unlimited evaluations",
      "OpenAI, Anthropic + Gemini providers",
      "Private challenges",
      "Detailed metrics & history",
      "Priority support",
    ],
    cta: "Go Pro",
    to: "/register",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For organizations with advanced needs.",
    features: [
      "Everything in Pro",
      "Self-hosted deployment",
      "Custom sandbox policies",
      "SSO & audit logging",
      "Dedicated support",
    ],
    cta: "Contact sales",
    to: "/about",
    featured: false,
  },
];

const COMPARISON: { label: string; values: [string, string, string] }[] = [
  { label: "Evaluations / month", values: ["50", "Unlimited", "Unlimited"] },
  { label: "LLM providers", values: ["Demo", "OpenAI, Anthropic, Gemini, Groq", "Everything in Pro"] },
  { label: "Private challenges", values: ["—", "✓", "✓"] },
  { label: "Metrics & history", values: ["7 days", "Unlimited", "Unlimited"] },
  { label: "Support", values: ["Community", "Priority", "Dedicated"] },
  { label: "Self-hosted deployment", values: ["—", "—", "✓"] },
  { label: "SSO & audit logging", values: ["—", "—", "✓"] },
];

const FAQ = [
  {
    question: "Is billing active on the prototype?",
    answer:
      "No. Pricing shown is illustrative — every tier is free to try, and no payment or billing is implemented.",
  },
  {
    question: "Which LLM providers are supported?",
    answer:
      "OpenAI, Anthropic and Gemini are integrated, plus a local Ollama server and a free Demo provider that needs no API key — perfect for trying the platform.",
  },
  {
    question: "How is generated code executed safely?",
    answer:
      "Each evaluation runs in a short-lived, resource-limited Docker container with CPU, memory and wall-clock limits and no network access, so a runaway solution is contained rather than trusted.",
  },
  {
    question: "Can I self-host the platform?",
    answer:
      "Yes — the project is open source and ships Docker Compose and Kubernetes manifests. Self-hosting support is part of the Enterprise tier.",
  },
];

function Pricing() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className="eyebrow">Pricing</span>
        <PageTitle size="lg" className={styles.title}>Simple, transparent pricing</PageTitle>
        <p className={styles.subtitle}>
          Start free and scale as your evaluation volume grows.
        </p>
      </header>

      <div className={styles.tiers}>
        {TIERS.map((tier) => (
          <Card
            key={tier.name}
            className={`${styles.tier} ${tier.featured ? styles.tierFeatured : ""}`}
          >
            {tier.featured && (
              <div className={styles.tierBadge}>
                <Badge variant="primary">Most popular</Badge>
              </div>
            )}
            <h2 className={styles.tierName}>{tier.name}</h2>
            <div className={styles.tierPrice}>
              {tier.price}
              {tier.price !== "Custom" && (
                <span className={styles.tierPriceSpan}> /mo</span>
              )}
            </div>
            <p className={styles.tierDescription}>{tier.description}</p>
            <ul className={styles.tierList}>
              {tier.features.map((feature) => (
                <li className={styles.tierItem} key={feature}>
                  <span className={styles.check}>✓</span>
                  {feature}
                </li>
              ))}
            </ul>
            <Button
              to={tier.to}
              variant={tier.featured ? "primary" : "secondary"}
              className={styles.tierButton}
            >
              {tier.cta}
            </Button>
          </Card>
        ))}
      </div>

      <section className={styles.section} aria-labelledby="comparison-title">
        <h2 id="comparison-title" className={styles.sectionTitle}>
          Compare plans
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {TIERS.map((tier) => (
                  <th scope="col" key={tier.name}>
                    {tier.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((value, index) => (
                    <td key={`${row.label}-${index}`}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="faq-title">
        <h2 id="faq-title" className={styles.sectionTitle}>
          Frequently asked questions
        </h2>
        <div className={styles.faq}>
          {FAQ.map((item) => (
            <details className={styles.faqItem} key={item.question}>
              <summary className={styles.faqQuestion}>{item.question}</summary>
              <p className={styles.faqAnswer}>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <p className={styles.note}>
        Pricing shown is illustrative for the prototype. Billing and payment
        processing are not implemented yet.
      </p>
    </div>
  );
}

export default Pricing;