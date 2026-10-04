import { Link, NavLink } from "react-router-dom";
import AmbientBackdrop from "../../components/AmbientBackdrop/AmbientBackdrop.tsx";
import Card from "../../components/Card/Card.tsx";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import {
  LEGAL_DISCLAIMER,
  LEGAL_DOCUMENTS,
  type LegalDocument,
} from "./content.ts";
import styles from "./Legal.module.css";

interface LegalShellProps {
  document: LegalDocument;
}

/**
 * Shared chrome for the legal pages: title block, revision date, the
 * template caveat, a sticky table of contents, and cross-links to the other
 * legal pages.
 *
 * All four pages render through this so the "not legal advice" notice, the
 * revision date, and the section navigation are physically incapable of
 * disagreeing between pages.
 */
export function LegalShell({ document }: LegalShellProps) {
  const others = LEGAL_DOCUMENTS.filter((doc) => doc.slug !== document.slug);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <AmbientBackdrop />
        <span className="eyebrow">Legal</span>
        <PageTitle size="lg" className={styles.title}>
          {document.title}
        </PageTitle>
        <p className={styles.subtitle}>{document.summary}</p>
        <p className={styles.revision}>
          Last updated:{" "}
          <time dateTime={document.lastUpdated}>{document.lastUpdated}</time>
        </p>
      </header>

      {/* The caveat sits above the content, not in a footnote: a reader must
          meet it before relying on anything below it. */}
      <div className={styles.disclaimer} role="note">
        <strong className={styles.disclaimerTitle}>Template, not legal advice</strong>
        <p className={styles.disclaimerText}>{LEGAL_DISCLAIMER}</p>
      </div>

      <div className={styles.layout}>
        <nav className={styles.toc} aria-label={`${document.title} contents`}>
          <h2 className={styles.tocTitle}>On this page</h2>
          <ul className={styles.tocList}>
            {document.sections.map((section) => (
              <li key={section.id}>
                <a className={styles.tocLink} href={`#${section.id}`}>
                  {section.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.body}>
          {document.sections.map((section) => (
            <Card key={section.id} className={styles.card}>
              <h2 className={styles.sectionTitle} id={section.id}>
                {section.heading}
              </h2>

              {section.note && (
                <p className={styles.note}>{section.note}</p>
              )}

              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className={styles.paragraph}>
                  {paragraph}
                </p>
              ))}

              {section.bullets && (
                <ul className={styles.bullets}>
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className={styles.bullet}>
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}

          <div className={styles.related}>
            <h2 className={styles.relatedTitle}>Related documents</h2>
            <ul className={styles.relatedList}>
              {others.map((doc) => (
                <li key={doc.slug}>
                  <NavLink
                    to={`/${doc.slug}`}
                    className={({ isActive }) =>
                      isActive ? styles.relatedLinkActive : styles.relatedLink
                    }
                  >
                    {doc.navLabel}
                  </NavLink>
                </li>
              ))}
            </ul>
            <Link to="/contact" className={styles.relatedLink}>
              Contact the operators
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LegalShell;
