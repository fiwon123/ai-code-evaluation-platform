import type { ReactNode } from "react";
import AmbientBackdrop from "../AmbientBackdrop/AmbientBackdrop.tsx";
import Card from "../Card/Card.tsx";
import Logo from "../Logo/Logo.tsx";
import PageTitle from "../PageTitle/PageTitle.tsx";
import styles from "./AuthLayout.module.css";

interface AuthLayoutProps {
  /** The page's own heading ("Welcome back"). */
  title: string;
  /** One line under the heading. */
  subtitle: string;
  /** The form, the OAuth button, or both. */
  children: ReactNode;
  /** Closing line under the card ("No account? Sign up"). */
  footer?: ReactNode;
}

/** What the aside claims, kept next to the component so copy and layout move
 *  together. Three lines is the most that stays readable at the bottom of a
 *  short viewport. */
const PROMISES = [
  {
    title: "Generate with the provider you pick",
    text: "OpenAI, Anthropic, Gemini, Groq, a local Ollama server, or the free demo model.",
  },
  {
    title: "Run the tests for real",
    text: "Generated code is executed against your suite inside a time-limited sandbox.",
  },
  {
    title: "Read the score, not a vibe",
    text: "Pass and fail counts, logs, and timing metrics for every run.",
  },
];

/**
 * The shell every unauthenticated page sits in.
 *
 * Login, Register, and the OAuth callback each hand-rolled the same centered
 * card on a gradient, which made signing in feel like a different product from
 * the landing page — the one page that has to sell the idea. This gives them
 * the landing page's treatment: an ambient backdrop on the left carrying the
 * product's three claims, the form on the right.
 *
 * The form comes FIRST in the source and the brand column second, with CSS
 * `order` moving the brand column to the left where there is room for it. That
 * is not a detail: below 1024px the aside is `display: none`, so source order is
 * the only thing that keeps the reading order honest — and it is also what stops
 * the aside's `<h2>` from preceding the page's `<h1>`, which is how a heading
 * outline ends up starting at level two.
 *
 * The blobs are the same `auroraDrift` decoration the hero uses, and since #402
 * they come from the shared `AmbientBackdrop` rather than a third copy of these
 * rules — an ambient animation that forgets to opt out of reduced motion is the
 * exact defect `ambient-motion.test.ts` exists to catch, and a guarantee that
 * depends on every copy remembering is not a guarantee.
 */
function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className={styles.page}>
      {/* Decorative only: every blob is aria-hidden and the whole backdrop is
          pointer-transparent, so it cannot intercept a click on the form. */}
      <AmbientBackdrop variant="auth" />

      <div className={styles.grid}>
        <div className={styles.main}>
          <Card className={styles.card}>
            <div className={styles.header}>
              <PageTitle size="sm" className={styles.title}>
                {title}
              </PageTitle>
              <p className={styles.subtitle}>{subtitle}</p>
            </div>
            {children}
            {footer ? <div className={styles.footer}>{footer}</div> : null}
          </Card>
        </div>

        <aside className={styles.aside}>
          <Logo size="lg" />
          <h2 className={styles.asideTitle}>
            Every AI solution, scored the same way
          </h2>
          <ul className={styles.promises}>
            {PROMISES.map((promise) => (
              <li key={promise.title} className={styles.promise}>
                <span className={styles.promiseTitle}>{promise.title}</span>
                <span className={styles.promiseText}>{promise.text}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

export default AuthLayout;
