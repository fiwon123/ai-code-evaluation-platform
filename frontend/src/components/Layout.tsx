import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import Button from "./Button/Button.tsx";
import Footer from "./Footer/Footer.tsx";
import styles from "./Layout.module.css";

function Layout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `${styles.link} ${isActive ? styles.linkActive : ""}`;

  return (
    <div>
      <header className={styles.header}>
        <nav className={styles.nav}>
          <Link to="/" className={styles.brand}>
            AI<span className={styles.brandAccent}>Code</span>Eval
          </Link>
          <button
            type="button"
            className={styles.menuToggle}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <ul className={`${styles.links} ${menuOpen ? styles.open : ""}`}>
            <li>
              <NavLink to="/" end className={navLinkClass} onClick={() => setMenuOpen(false)}>
                Home
              </NavLink>
            </li>
            <li>
              <NavLink to="/features" className={navLinkClass} onClick={() => setMenuOpen(false)}>
                Features
              </NavLink>
            </li>
            <li>
              <NavLink to="/pricing" className={navLinkClass} onClick={() => setMenuOpen(false)}>
                Pricing
              </NavLink>
            </li>
            <li>
              <NavLink to="/demo" className={navLinkClass} onClick={() => setMenuOpen(false)}>
                Demo
              </NavLink>
            </li>
            <li>
              <NavLink to="/challenges" className={navLinkClass} onClick={() => setMenuOpen(false)}>
                Challenges
              </NavLink>
            </li>
            <li className={styles.auth}>
              {user ? (
                <>
                  <span className={styles.userInfo}>
                    Logged in as <span className={styles.username}>{user.username}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      logout();
                      setMenuOpen(false);
                    }}
                  >
                    Log out
                  </Button>
                </>
              ) : (
                <>
                  <NavLink to="/login" className={navLinkClass} onClick={() => setMenuOpen(false)}>
                    Log in
                  </NavLink>
                  <Link to="/register" onClick={() => setMenuOpen(false)}>
                    <Button size="sm">Sign up</Button>
                  </Link>
                </>
              )}
            </li>
          </ul>
        </nav>
      </header>
      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
        <Footer />
      </main>
    </div>
  );
}

export default Layout;