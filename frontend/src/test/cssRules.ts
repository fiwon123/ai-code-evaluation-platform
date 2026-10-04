/**
 * Helpers for tests that assert on a stylesheet's *text*.
 *
 * These read declarations, so on their own they can prove a rule says something
 * and can prove it stops saying it. They cannot see the box model: no amount of
 * reading `.nav` proves the links ended up on the header's centre line, because
 * that depends on the DOM order, the rendered widths and the viewport. So a test
 * using these is only half a lock and has to be paired with something that
 * measures — `Layout.nav-centering.test.tsx` pairs with `e2e/nav.spec.ts`,
 * `input-contrast.test.ts` with the painted page.
 *
 * What these *do* catch on their own is the two ways a stylesheet drifts
 * silently: a declaration being reverted, and a declaration that no longer
 * applies because the element it targeted moved. The first needs the text, the
 * second needs the DOM, and callers get both from here.
 *
 * Brace-counting rather than a real CSS parser: the app has no postcss parser
 * reachable from a test, and a rule body here is a handful of declarations. A
 * parser's one real advantage — not matching a selector that appears inside a
 * comment — is handled by `stripCssComments`, which every helper applies first,
 * so a comment that *talks* about `.nav` cannot be read as a `.nav` rule.
 */

/** Comments removed, so a selector named in prose cannot be read as a rule. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The body of the first rule declared for `selector`, brace-balanced.
 *
 * Matches `selector` only when it is immediately followed by `{`, so `.navLeft`
 * does not resolve to `.navLeftSomething` and a mention of the selector in a
 * comment cannot match at all. Pass the narrower scope when the selector is
 * declared more than once — `ruleBody(mediaBlock.body, ".nav")` for the copy
 * inside a `@media`, since the base rule comes first in the file.
 */
export function ruleBody(stylesheet: string, selector: string): string {
  const css = stripCssComments(stylesheet);
  const pattern = new RegExp(`(^|[{};,])\\s*${escapeRegExp(selector)}\\s*\\{`, "g");
  const match = pattern.exec(css);
  if (match === null) {
    throw new Error(`no rule found for "${selector}"`);
  }
  const open = css.indexOf("{", match.index + match[0].length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after "${selector}"`);
}

/** Every `@media (max-width: …)` block, keyed by its condition (e.g. `768px`). */
export function maxWidthMediaBlocks(stylesheet: string): { condition: string; body: string }[] {
  const css = stripCssComments(stylesheet);
  const blocks: { condition: string; body: string }[] = [];
  const pattern = /@media\s*\(max-width:\s*([^)]+)\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    const open = pattern.lastIndex - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push({ condition: match[1]!.trim(), body: css.slice(open + 1, end) });
    pattern.lastIndex = end;
  }
  return blocks;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
