import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Puts the window back at the top on client-side navigation.
 *
 * `BrowserRouter` does no scroll restoration of its own: a `<Link>` swaps the
 * route in place, so the next page renders at the previous `window.scrollY` and
 * the window never moves. The reader lands wherever they were on the page they
 * just left. It reads as "the link didn't work" — and on a page shorter than
 * that offset the browser clamps to the bottom, so a link you followed to reach
 * the *top* of a document opens it at the *end*.
 *
 * The footer is the worst case, and the legal pages are the worst case of the
 * footer: the only route to them is the very bottom of the page, so the offset
 * being inherited is always the height of a full page of content. This is a
 * routing-level fix, so it lives here and covers every link in the app rather
 * than being patched per page.
 *
 * Three cases are deliberately *not* a reset-to-top:
 *
 * - **Back/forward (`POP`).** The browser restores the previous offset, and
 *   forcing the top would throw away the reader's place — the opposite of what
 *   they asked for by pressing back. `useNavigationType` is what distinguishes
 *   this from a `PUSH`, and it comes from the router rather than from sniffing
 *   `window.history.state`: a user who lands straight on a deep link has no
 *   React Router history entry to read, and a history-index comparison silently
 *   degrades to "unknown" exactly there.
 * - **A navigation with a hash.** The link asked for a specific section; the
 *   scroll position is the whole point. Handled explicitly below, because the
 *   browser's native anchor lookup misses a *cross-page* hash: the target
 *   element does not exist yet when the navigation happens, and React only
 *   renders it after the route commits. (A same-page `<a href="#id">` click
 *   never reaches here — it does not go through the router at all, so the
 *   location is unchanged and the browser's own behaviour plus the section's
 *   `scroll-margin-top` still apply.)
 * - **The first mount.** Nothing navigated. This is checked explicitly because
 *   `useNavigationType` reports `"POP"` before any navigation has happened,
 *   which would be a right answer for the wrong reason — and would stop working
 *   the moment that default changed.
 *
 * The scroll is instant rather than smooth on purpose. An animated jump on
 * every route change reads as lag and hides the new page while it plays, and
 * instant needs no `prefers-reduced-motion` special-casing. `useLayoutEffect`
 * runs before paint so the destination is never briefly visible at the wrong
 * offset.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const hasNavigated = useRef(false);

  useLayoutEffect(() => {
    const isFirstRender = !hasNavigated.current;
    hasNavigated.current = true;

    if (hash) {
      // `slice` drops the leading "#". `getElementById` takes the raw id
      // rather than a selector, so no escaping is needed.
      const target = document.getElementById(hash.slice(1));
      if (target) {
        target.scrollIntoView();
        return;
      }
      // A hash naming a section this page does not have — the top beats
      // leaving the reader at the bottom of a document they just opened.
      window.scrollTo(0, 0);
      return;
    }

    if (isFirstRender || navigationType === "POP") return;
    window.scrollTo(0, 0);
  }, [pathname, hash, navigationType]);

  return null;
}
