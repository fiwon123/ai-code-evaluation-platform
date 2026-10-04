import styles from "./AmbientBackdrop.module.css";

export type AmbientBackdropVariant = "wash" | "auth";

interface AmbientBackdropProps {
  /**
   * Which geometry to use.
   *
   * - `wash` — two blobs, the page-header wash. This is what every route uses
   *   (issue #402); the numbers are `Demo`'s, which is the one instance of this
   *   decoration that was ever applied to a page header.
   * - `auth` — three, with the teal/violet pair `AuthLayout` has always had.
   *   Kept as a variant rather than deleted: the sign-in shell has carried that
   *   palette since it was built, and swapping it for the header wash would be a
   *   redesign nobody asked for.
   *
   * `Home` is deliberately not a variant. Its hero layer is a different
   * decoration — three larger blobs, a code grid and drifting code fragments —
   * and it stays in `Home.module.css`.
   */
  variant?: AmbientBackdropVariant;
}

/**
 * The drifting colour blobs behind a page header (issue #402).
 *
 * ## Why this is a component
 *
 * The decoration existed in three hand-copied modules and nowhere else: `Home`'s
 * hero, `AuthLayout`'s page-wide shell and `Demo`'s header card. Three copies is
 * the exact shape that already produced a silent bug — see the comment at the
 * top of `styles/ambient.css` for how a keyframe reference rewritten by the
 * CSS-modules pass left four families of ambient motion dead while every test
 * stayed green. Nineteen more copies would have been the same trap with more
 * surface area, so the wash is declared once and composed.
 *
 * ## The contract every caller must keep
 *
 * The backdrop sits at `z-index: -1`, which only means "behind the content" if
 * the element that *contains* it establishes a stacking context. Without
 * `isolation: isolate` on that container the backdrop escapes behind the page
 * background and vanishes — a negative-z-index child of a non-isolating parent
 * paints behind that parent's own background. `overflow: hidden` is the other
 * half: the blobs carry an 80px blur, and without clipping the blur bleeds over
 * whatever follows the header.
 *
 * So a caller adds all three:
 *
 *     position: relative;   /* anchors the absolute backdrop        *\/
 *     isolation: isolate;   /* makes z-index: -1 mean "behind"     *\/
 *     overflow: hidden;     /* clips the blur to the header         *\/
 *
 * `AmbientBackdrop.test.tsx` locks that trio against every page shell that uses
 * this, because a header missing one of the three renders fine in a unit test
 * and wrong in a browser.
 */
export default function AmbientBackdrop({ variant = "wash" }: AmbientBackdropProps) {
  return (
    // Decorative only: `aria-hidden` keeps it out of the a11y tree and
    // `pointer-events: none` (in the stylesheet) keeps it from intercepting a
    // click meant for the page.
    <div className={`${styles.backdrop} ${styles[variant]}`} aria-hidden="true">
      <span className={`${styles.blobPrimary} ${styles.drift}`} />
      {variant === "auth" ? (
        <>
          <span className={`${styles.blobTeal} ${styles.drift}`} />
          <span className={`${styles.blobViolet} ${styles.drift}`} />
        </>
      ) : (
        <span className={`${styles.blobAccent} ${styles.drift}`} />
      )}
    </div>
  );
}
