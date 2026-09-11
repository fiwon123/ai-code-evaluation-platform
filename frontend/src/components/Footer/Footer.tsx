import { Link } from "react-router-dom";
import Logo from "../Logo/Logo.tsx";
import styles from "./Footer.module.css";

const PRODUCT_LINKS = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/demo", label: "Demo" },
  { to: "/challenges", label: "Challenges" },
];

const COMPANY_LINKS = [
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
  { to: "/login", label: "Log in" },
  { to: "/register", label: "Sign up" },
];

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.columns}>
          <div className={styles.brandCol}>
            <Link to="/" className={styles.brand}>
              <Logo size="sm" />
            </Link>
            <p className={styles.tagline}>
              AI-powered code evaluation. Generate solutions with LLMs and
              verify correctness with automated test suites.
            </p>
          </div>

          <div className={styles.col}>
            <h3 className={styles.colTitle}>Product</h3>
            <ul className={styles.colLinks}>
              {PRODUCT_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className={styles.link}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.col}>
            <h3 className={styles.colTitle}>Company</h3>
            <ul className={styles.colLinks}>
              {COMPANY_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className={styles.link}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className={styles.bottom}>
          <span className={styles.copyright}>
            © {new Date().getFullYear()} AI Code Evaluation Platform — Open
            source prototype
          </span>
          <a
            href="https://github.com/fiwon123/ai-code-evaluation-platform"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.github}
            aria-label="GitHub repository"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </footer>
  );
}

export default Footer;