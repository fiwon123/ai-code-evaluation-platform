import { Link } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
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
      "OpenAI + Anthropic providers",
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

function Pricing() {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Simple, transparent pricing</h1>
      <p className={styles.pageSubtitle}>
        Start free and scale as your evaluation volume grows.
      </p>

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
            <Link to={tier.to} className={styles.tierButton}>
              <Button
                variant={tier.featured ? "primary" : "secondary"}
                className={styles.tierButton}
              >
                {tier.cta}
              </Button>
            </Link>
          </Card>
        ))}
      </div>

      <p className={styles.note}>
        Pricing shown is illustrative for the prototype. Billing and payment
        processing are not implemented yet.
      </p>
    </div>
  );
}

export default Pricing;