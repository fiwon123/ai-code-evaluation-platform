import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import Button from "./Button/Button.tsx";
import Footer from "./Footer/Footer.tsx";
import Logo from "./Logo/Logo.tsx";
import ThemeToggle from "./ThemeToggle/ThemeToggle.tsx";
import styles from "./Layout.module.css";

function Layout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `${styles.link} ${isActive ? styles.linkActive : ""}`;

  function closeMenus() {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }

  return (
    <div>
      <header className={styles.header}>
        <nav className={styles.nav}>
          <div className={styles.navLeft}>
            <Link to="/" className={styles.brand} onClick={closeMenus}>
              <Logo />
            </Link>
            <ul className={`${styles.links} ${menuOpen ? styles.open : ""}`}>
              <li>
                <NavLink to="/" end className={navLinkClass} onClick={closeMenus}>
                  Home
                </NavLink>
              </li>
              <li>
                <NavLink to="/features" className={navLinkClass} onClick={closeMenus}>
                  Features
                </NavLink>
              </li>
              <li>
                <NavLink to="/demo" className={navLinkClass} onClick={closeMenus}>
                  Demo
                </NavLink>
              </li>
              <li>
                <NavLink to="/challenges" className={navLinkClass} onClick={closeMenus}>
                  Challenges
                </NavLink>
              </li>
              <li>
                <NavLink to="/pricing" className={navLinkClass} onClick={closeMenus}>
                  Pricing
                </NavLink>
              </li>
              <li className={styles.mobileAuth}>
                {user ? (
                  <>
                    <Link to="/profile" className={styles.link} onClick={closeMenus}>
                      Profile
                    </Link>
                    {user.is_admin && (
                      <Link to="/admin" className={styles.link} onClick={closeMenus}>
                        Admin
                      </Link>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        logout();
                        closeMenus();
                      }}
                    >
                      Log out
                    </Button>
                  </>
                ) : (
                  <>
                    <NavLink to="/login" className={navLinkClass} onClick={closeMenus}>
                      Log in
                    </NavLink>
                    <Link to="/register" onClick={closeMenus}>
                      <Button size="sm">Sign up</Button>
                    </Link>
                  </>
                )}
              </li>
            </ul>
          </div>

          <div className={styles.navRight}>
            <ThemeToggle />
            {user ? (
              <div className={styles.userMenu}>
                {userMenuOpen && (
                  <div
                    className={styles.dropdownBackdrop}
                    onClick={() => setUserMenuOpen(false)}
                    aria-hidden="true"
                  />
                )}
                <button
                  type="button"
                  className={styles.userButton}
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                >
                  <span className={styles.avatar}>{user.username.charAt(0).toUpperCase()}</span>
                  <span className={styles.userName}>{user.username}</span>
                  <span className={styles.caret} aria-hidden="true">
                    ▼
                  </span>
                </button>
                {userMenuOpen && (
                  <div className={styles.dropdown} role="menu">
                    <div className={styles.dropdownHeader}>
                      <span className={styles.dropdownName}>{user.username}</span>
                      <span className={styles.dropdownEmail}>{user.email}</span>
                    </div>
                    <Link
                      to="/profile"
                      className={styles.dropdownItem}
                      role="menuitem"
                      onClick={closeMenus}
                    >
                      Profile
                    </Link>
                    {user.is_admin && (
                      <Link
                        to="/admin"
                        className={styles.dropdownItem}
                        role="menuitem"
                        onClick={closeMenus}
                      >
                        Admin
                      </Link>
                    )}
                    <Link
                      to="/challenges/new"
                      className={styles.dropdownItem}
                      role="menuitem"
                      onClick={closeMenus}
                    >
                      New challenge
                    </Link>
                    <button
                      type="button"
                      className={styles.dropdownItem}
                      role="menuitem"
                      onClick={() => {
                        logout();
                        closeMenus();
                      }}
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.authActions}>
                <NavLink to="/login" className={navLinkClass}>
                  <Button variant="ghost" size="sm">
                    Log in
                  </Button>
                </NavLink>
                <Link to="/register">
                  <Button size="sm">Sign up</Button>
                </Link>
              </div>
            )}
          </div>

          <button
            type="button"
            className={styles.menuToggle}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
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