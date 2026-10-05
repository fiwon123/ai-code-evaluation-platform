/**
 * The one page header: the ambient host, the title, the subtitle, and the
 * optional pieces that sit inside them.
 *
 * Until this existed, `PageTitle` was the only shared part of a page header —
 * the *type* of the `<h1>` was centralized while the block around it was not.
 * Sixteen pages therefore hand-rolled the same four things, and issue #402 (the
 * ambient wash) had to go and add that same block to fifteen of them one page at
 * a time: the host trio that lets a backdrop paint behind the text without
 * escaping it, the backdrop itself, a title margin and a subtitle. The shape was
 * re-derived and re-measured fifteen times, and it still drifted — three title
 * margins, two names for the shell (`.header`, `.pageHeader`), a breadcrumb rule
 * duplicated verbatim in two modules, and one subtitle role split across two
 * colour tokens.
 *
 * Two tones, named for the groups `page-rhythm.test.ts` already registers:
 *
 * - `app` — dashboards, lists and forms: a compact title, a small subtitle, and
 *   an optional `actions` slot to the right of the text.
 * - `marketing` — landing and informational pages: the larger title, the 600px
 *   subtitle measure, and centring.
 *
 * Those tiers were measured and shipped in #309; this adopts them rather than
 * reopening them, so migrating a page does not silently restyle it.
 *
 * @scope Adoption is deliberately partial (#404): `/challenges`, the two
 * challenge forms and the legal pages use this, while the other marketing pages,
 * the admin suite, `NotFound` and the three detail rows still hand-roll the same
 * block. The `detail` group has no tone yet because nothing using it has been
 * migrated — adding one would be a variant with no caller, which is how a
 * component starts lying about what the app actually does.
 */
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import AmbientBackdrop from "../AmbientBackdrop/AmbientBackdrop.tsx";
import PageTitle from "../PageTitle/PageTitle.tsx";
import styles from "./PageHeader.module.css";

/** `app` — dashboards, lists, forms · `marketing` — landing and informational · `detail` — a single record. */
export type PageHeaderTone = "app" | "marketing" | "detail";

/** One step of the `breadcrumb`. The step without a `to` is the current page. */
export interface PageHeaderCrumb {
  label: string;
  /** Omit on the current page, which renders as text rather than a link. */
  to?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  tone?: PageHeaderTone;
  subtitle?: ReactNode;
  /** Small label above the title. All five marketing pages use this badge. */
  eyebrow?: ReactNode;
  breadcrumb?: readonly PageHeaderCrumb[];
  /** A quiet line under the subtitle — the legal pages' revision date. */
  meta?: ReactNode;
  /** Right-hand slot, e.g. `/challenges`' "New challenge" button. */
  actions?: ReactNode;
  /** Play the shared entrance animation. A per-page decision; see the CSS. */
  animate?: boolean;
  /** Page-specific layout only (measure, margins) — never the host contract. */
  className?: string;
}

export function PageHeader({
  title,
  tone = "app",
  subtitle,
  eyebrow,
  breadcrumb,
  meta,
  actions,
  animate,
  className,
}: PageHeaderProps) {
  const marketing = tone === "marketing";
  const classes = [styles.header, styles[tone]];
  if (animate) {
    classes.push(styles.animated!);
  }
  if (className) {
    classes.push(className);
  }

  return (
    <header className={classes.join(" ")}>
      <AmbientBackdrop />
      {/* The text column, so `actions` can sit beside the whole block rather
          than beside its first line — and so it fills the measure instead of
          hugging its own text. The breadcrumb lives inside it, not beside it:
          as a sibling it competed with the column for the row's width and
          wrapped the two challenge forms onto two lines, which is exactly what
          the before/after measurement caught (#404). */}
      <div className={styles.text}>
        {breadcrumb && breadcrumb.length > 0 ? (
          <nav className={styles.crumbs} aria-label="Breadcrumb">
            {breadcrumb.map((crumb, index) => (
              <Fragment key={crumb.label}>
                {/* From the second crumb on, so the trail never opens with a slash. */}
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {crumb.to ? (
                  <Link to={crumb.to} className={styles.crumbLink}>
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
              </Fragment>
            ))}
          </nav>
        ) : null}
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <PageTitle size={marketing ? "lg" : "md"} className={styles.title}>
          {title}
        </PageTitle>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        {meta}
      </div>
      {actions}
    </header>
  );
}

export default PageHeader;
