import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader/PageHeader.tsx";
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
      <PageHeader
        tone="app"
        title="404 — Page Not Found"
        subtitle="The page you're looking for doesn't exist."
      />
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