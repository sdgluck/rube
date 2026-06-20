import { NavLink, Link } from "react-router-dom";
import GithubIcon from "#components/GithubIcon";
import { GITHUB_URL } from "#data/content";
import styles from "./Nav.module.css";

export default function Nav() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link to="/" className={styles.brand}>
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <span>Tinkerbell</span>
        </Link>
        <nav className={styles.links}>
          <NavLink to="/features" className={({ isActive }) => (isActive ? styles.active : undefined)}>
            Features
          </NavLink>
          <NavLink to="/screenshots" className={({ isActive }) => (isActive ? styles.active : undefined)}>
            Screenshots
          </NavLink>
          <a href={GITHUB_URL} className={styles.github} target="_blank" rel="noreferrer">
            <GithubIcon size={16} />
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
