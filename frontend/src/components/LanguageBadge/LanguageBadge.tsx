import type { CSSProperties } from "react";
import { languageMeta } from "../../utils/language.ts";
import styles from "./LanguageBadge.module.css";

interface LanguageBadgeProps {
  /** Challenge language value ("csharp", "objective-c", …). */
  language: string | null | undefined;
  className?: string;
  /** Hide the symbol chip, showing only the tinted label (default true). */
  showSymbol?: boolean;
}

/**
 * Language identity pill: brand-color symbol chip + label on a tinted
 * surface, with the display name and runner ("C++ · g++", "C# · catalog
 * only") in a native title tooltip. Colors live in `utils/language.ts`
 * (`LANGUAGE_META`), mirrored from the backend catalog.
 */
function LanguageBadge({ language, className = "", showSymbol = true }: LanguageBadgeProps) {
  if (!language) {
    return null;
  }
  const meta = languageMeta(language);
  const style = { "--lang-color": meta.color } as CSSProperties;
  const classes = [styles.badge, className].filter(Boolean).join(" ");
  return (
    <span className={classes} style={style} title={meta.title}>
      {showSymbol && (
        <span className={styles.symbol} aria-hidden="true">
          {meta.symbol}
        </span>
      )}
      <span>{meta.label}</span>
    </span>
  );
}

export default LanguageBadge;