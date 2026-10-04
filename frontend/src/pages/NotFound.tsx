import { Link } from "react-router-dom";

import AmbientBackdrop from "../components/AmbientBackdrop/AmbientBackdrop.tsx";
import PageTitle from "../components/PageTitle/PageTitle.tsx";
import styles from "./NotFound.module.css";

/**
 * The 404 page is the one page a user reaches by following a dead link, so it
 * was the one page with no shell at all: a bare `<div>` with no class, no
 * gutter, and no page rhythm. It now has the same `.page` shell as every other
 * app page (verified by `page-rhythm.test.ts`) and the same app header rhythm:
 * a title over a muted subtitle, then the recovery actions.
 *
 * The actions are plain links rather than `<Link><Button>` — nesting a button
 * inside an anchor is invalid and makes two focus stops for one action. The
 * shared `Button` is fixing that properly in #244; until then a link that looks
 * like a link is the honest option.
 */
function NotFound() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <AmbientBackdrop />
        <PageTitle className={styles.title}>404 — Page Not Found</PageTitle>
        <p className={styles.subtitle}>
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
      </header>
      <div className={styles.actions}>
        <Link to="/challenges" className={styles.action}>
          Browse challenges
        </Link>
        <Link to="/" className={styles.action}>
          Back to home
        </Link>
      </div>
    </div>
  );
}

export default NotFound;