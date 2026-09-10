import { Link } from "react-router-dom";
import styles from "./Footer.module.css";

const NAV_LINKS = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/demo", label: "Demo" },
  { to: "/about", label: "About" },
];

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand}>
          AI Code Evaluation Platform
        </Link>
        <ul className={styles.links}>
          {NAV_LINKS.map((link) => (
            <li key={link.to}>
              <Link to={link.to} className={styles.link}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <span className={styles.copyright}>
          © {new Date().getFullYear()} — Open source prototype
        </span>
      </div>
    </footer>
  );
}

export default Footer;