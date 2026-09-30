/**
 * Query helpers for code surfaces.
 *
 * `screen.getByText(/def two_sum/)` used to be the way every report test
 * asserted on generated source, and it broke the moment `CodeBlock` started
 * splitting code into token spans (#356). Testing Library's `getByText` matches
 * an element's *direct* text-node children, so a `<code>` whose contents are
 * `<span>def</span><span> </span><span>two_sum</span>` no longer matches a
 * regex spanning several of those runs — the text is still all there, it is
 * just no longer contiguous in any single node.
 *
 * These helpers match on the assembled `textContent` of a `<code>` element
 * instead, which is the thing the assertion actually means: "the reader sees
 * this source". Using them keeps the tests describing behaviour rather than the
 * DOM shape, so the next renderer change does not invalidate them.
 */

/** Every `<code>` element's assembled text, in document order. */
export function allCodeText(): string[] {
  return [...document.querySelectorAll("code")].map((el) => el.textContent ?? "");
}

/** The `<code>` element whose full text matches `pattern`, or undefined. */
export function findCode(pattern: RegExp): HTMLElement | undefined {
  return [...document.querySelectorAll("code")].find((el) =>
    pattern.test(el.textContent ?? ""),
  );
}

/**
 * Assert some code surface contains `pattern` as one contiguous run of text.
 * Throws with the available sources listed, which is the debugging aid the
 * original failing assertions lacked.
 */
export function expectCodeToContain(pattern: RegExp | string): void {
  const matches = (text: string): boolean =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
  if (allCodeText().some(matches)) return;
  const seen = allCodeText().map((text) => JSON.stringify(text.slice(0, 120)));
  throw new Error(
    `no code surface contained ${String(pattern)}\n` +
      (seen.length ? `code surfaces found:\n  ${seen.join("\n  ")}` : "no <code> elements were rendered"),
  );
}

/** Assert no code surface contains `pattern`. */
export function expectCodeNotToContain(pattern: RegExp | string): void {
  const matches = (text: string): boolean =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
  const hit = allCodeText().find(matches);
  if (hit === undefined) return;
  throw new Error(`a code surface unexpectedly contained ${String(pattern)}: ${JSON.stringify(hit)}`);
}
