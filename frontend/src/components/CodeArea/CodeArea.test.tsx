import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HIGHLIGHT_KINDS, highlight } from "../CodeBlock/highlight";
import CodeArea from "./CodeArea.tsx";
import styles from "./CodeArea.module.css";

/**
 * The component's whole design rests on one claim: the `<textarea>` is still the
 * control, and a `<pre>` behind it is only a picture. Every test here is an
 * attempt to break that — either by finding that the paint has become the
 * accessible element, that the two layers have desynchronised, or that the
 * styling no longer produces the overlay it describes.
 *
 * The parts jsdom cannot see (glyph alignment, the caret, whether the
 * transparent text is really invisible) are asserted against the stylesheet
 * instead, because the CSS *is* the mechanism for those: an overlay is a
 * contract between two rules, and if the rules drift the contract is broken even
 * though every DOM assertion still passes.
 */

/** The painted layer: `aria-hidden`, so it is the only `<pre>` in the tree. */
function paint(): HTMLElement {
  const pre = document.querySelector("pre");
  expect(pre, "the paint layer must render").not.toBeNull();
  return pre as HTMLElement;
}

/** jsdom does no layout, so scroll offsets must be installed to be readable. */
function withScroll<T extends HTMLElement>(el: T): T {
  for (const prop of ["scrollTop", "scrollLeft"] as const) {
    Object.defineProperty(el, prop, { value: 0, writable: true, configurable: true });
  }
  return el;
}

function renderArea(props: Partial<React.ComponentProps<typeof CodeArea>> = {}) {
  const onChange = vi.fn();
  // The value is a JSX *expression*, not a string attribute: JSX string literals
  // do not interpret `\n`, so `value="a\nb"` would hand the control a literal
  // backslash-n. (`ChallengeFormFields` passes `{value.prompt}`, so this is a
  // property of the test fixture rather than of the form.)
  const PYTHON = "def add(a, b):\n    return a + b";
  // A real `<label htmlFor>`, because that is how `Field` names this control in
  // the form. A `label="…"` *attribute* is not a labelling mechanism for a
  // textarea and would make this test pass for the wrong reason.
  render(
    <>
      <label htmlFor="code-under-test">Code</label>
      <CodeArea
        id="code-under-test"
        language="python"
        value={PYTHON}
        onChange={onChange}
        {...props}
      />
    </>,
  );
  return { onChange, control: withScroll(screen.getByRole("textbox") as HTMLTextAreaElement) };
}

describe("CodeArea keeps the value in a real control", () => {
  it("is a labelled textbox holding the value, not a picture of one", () => {
    const { control } = renderArea();

    // The accessible control, with its label and its value. A screen reader must
    // find the code here and nowhere else.
    const textbox = screen.getByRole("textbox", { name: "Code" });
    expect(textbox.tagName).toBe("TEXTAREA");
    expect((textbox as HTMLTextAreaElement).value).toBe("def add(a, b):\n    return a + b");
    expect(textbox).toBe(control);
  });

  it("hides the paint from assistive tech, so the code is not read twice", () => {
    renderArea();

    // `aria-hidden` is the whole reason this is safe. Without it the paint and
    // the textarea both expose the same text and a screen reader announces it
    // twice, interleaved token by token.
    expect(paint().getAttribute("aria-hidden")).toBe("true");
    // And there is only one control in the tab order.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("reports edits from the control, so the form still owns the value", () => {
    const { onChange } = renderArea();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x = 1" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("renders a non-string value instead of showing an empty field", () => {
    // `value` is typed as the full React value, so a number is legal at the type
    // level. A code editor that renders a blank box for a number is a silent
    // data-loss bug; coercing to a string is visible instead.
    render(<CodeArea id="code-under-test" language="python" value={42 as unknown as string} onChange={() => {}} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("42");
  });
});

describe("CodeArea mirrors the control's scroll onto the paint", () => {
  // This is the single most visible bug the component can have: the textarea
  // scrolls, the paint does not, and the highlighted text slides under a
  // stationary field. It is also invisible in a DOM-only test, so it is locked
  // explicitly rather than left to the styling to be obviously correct.
  it("copies scrollTop and scrollLeft across", () => {
    const { control } = renderArea();
    const pre = withScroll(paint());

    control.scrollTop = 120;
    control.scrollLeft = 34;
    fireEvent.scroll(control);

    expect(pre.scrollTop).toBe(120);
    expect(pre.scrollLeft).toBe(34);
  });

  it("keeps mirroring on every scroll event, not only the first", () => {
    // A handler that set the offset once would pass the test above and fail in
    // use, because the paint and the control desynchronise on the *second*
    // scroll as soon as the user scrolls back up.
    const { control } = renderArea();
    const pre = withScroll(paint());

    control.scrollTop = 200;
    fireEvent.scroll(control);
    expect(pre.scrollTop).toBe(200);

    control.scrollTop = 0;
    fireEvent.scroll(control);
    expect(pre.scrollTop).toBe(0);
  });

  it("still calls the caller's own onScroll", () => {
    const onScroll = vi.fn();
    const { control } = renderArea({ onScroll });

    fireEvent.scroll(control);

    // The component owns the mirroring, but it did not take the prop over: a
    // caller passing `onScroll` would otherwise find it silently dropped.
    expect(onScroll).toHaveBeenCalledTimes(1);
  });
});

describe("CodeArea paints the value with the language's tokens", () => {
  it("emits one span per token, tagged with its kind", () => {
    renderArea();

    // `data-token` is the stable hook: with `css: true` the class names are
    // hashed, so the kind attribute is what can be asserted without pinning a
    // generated identifier.
    const kinds = [...paint().querySelectorAll("[data-token]")].map((el) =>
      el.getAttribute("data-token"),
    );
    const expected = highlight("def add(a, b):\n    return a + b", "python");
    expect(expected).not.toBeNull();
    expect(kinds).toEqual(expected!.map((token) => token.kind));
  });

  it("gives each kind its own class, and leaves plain runs unstyled", () => {
    renderArea();

    const byKind = new Map(
      [...paint().querySelectorAll("[data-token]")].map((el) => [
        el.getAttribute("data-token"),
        el.className,
      ]),
    );
    // `keyword` and `function` must not share a class: "these two differ" would
    // pass if both were mapped to the wrong token.
    expect(byKind.get("keyword")).toBe(styles.keyword);
    expect(byKind.get("function")).toBe(styles.function);
    // `plain` is deliberately unclassed — wrapping every space and brace would
    // multiply the DOM for no visual gain.
    expect(byKind.get("plain")).toBe("");
  });

  it("paints exactly the text in the control, so the layers cannot disagree", () => {
    const { control } = renderArea();

    // The two layers are the same string by construction. Asserting it directly
    // catches a transform applied to one and not the other.
    const painted = paint().textContent ?? "";
    const trailing = control.value.endsWith("\n") ? "\n" : "";
    expect(painted).toBe(control.value + trailing);
    // And specifically: no newline is invented when the value has none, which is
    // what would desynchronise the caret by a whole line.
    expect(painted.startsWith(control.value)).toBe(true);
  });

  it("gives a trailing newline its own line box", () => {
    // A `<pre>` collapses a trailing newline, so without the extra one the paint
    // would stop a line short of where the caret actually is — most visibly on
    // every test suite, since they all end in a newline.
    //
    // The highlighter must run on the *padded* text. Tokenizing the raw value
    // instead drops the padding for exactly the languages this component is used
    // with, and the failure is invisible for a value with no trailing newline —
    // which is why this pins the newline explicitly rather than resting on the
    // equivalence test above.
    const { control } = renderArea({ value: "x = 1\n" });
    expect(control.value.endsWith("\n")).toBe(true);
    expect((paint().textContent ?? "").endsWith("\n\n")).toBe(true);
  });

  it("shows the dark surface for a language it cannot tokenize, rather than no code", () => {
    // An unknown language must still be an editable dark field: falling back to a
    // light form control would read as "this language is unsupported".
    renderArea({ language: "cobol" });

    const pre = paint();
    expect(pre.textContent).toContain("def add");
    expect(highlight("def add(a, b):", "cobol")).toBeNull();
    // Nothing tokenized, so the text is one bare run rather than spans.
    expect(pre.querySelectorAll("[data-token]")).toHaveLength(0);
  });

  it("does not tokenize prose, so an English prompt is not painted as code", () => {
    // `text` is the catalog's marker for prose. Tokenizing it paints the first
    // word of every sentence as a keyword.
    renderArea({ language: "text", value: "return the sum of two numbers" });

    expect(paint().querySelectorAll("[data-token]")).toHaveLength(0);
    expect(paint().textContent).toBe("return the sum of two numbers");
  });

  it("marks an empty field so its paint adds no phantom line", () => {
    renderArea({ value: "" });

    // An empty `<pre>` must not set the box's minimum height, or a cleared field
    // would look taller than a field with content in it.
    expect(paint().className).toContain(styles.empty);
  });

  it("styles every token kind the highlighter can emit", () => {
    // The highlighter and this stylesheet are two files; a new kind with no rule
    // renders in the default code colour and the feature looks half done. Same
    // check `theme-contrast.test.ts` makes for CodeBlock, kept in step by
    // iterating the highlighter's own list.
    const styleSheet = styles as unknown as Record<string, string>;
    for (const kind of HIGHLIGHT_KINDS) {
      if (kind === "plain") continue;
      expect(styleSheet[kind], `CodeArea.module.css must define .${kind}`).toBeTruthy();
    }
  });
});

describe("CodeArea's stylesheet keeps the two layers in step", () => {
  // An overlay is a contract between two rules. jsdom resolves no layout, so
  // these are asserted against the source: the shared metrics have to be shared
  // *by construction*, because a value pasted into two rules is a value that
  // will eventually be corrected in only one of them.
  const source = () => {
    // The module is already compiled to class names, so the shared rule is read
    // back from the raw file rather than the generated object.
    return CSS_SOURCE;
  };

  it("has both layers compose one shared base rule, rather than repeat it", () => {
    const css = source();
    const base = css.match(/^\.layer \{([^}]*)\}/m)?.[1];
    expect(base, "CodeArea.module.css must define a shared .layer rule").toBeTruthy();

    // The base must hold every metric that decides where a glyph lands. Missing
    // `tab-size` or a wrapping property desynchronises the paint silently.
    for (const property of [
      "font-family",
      "font-size",
      "line-height",
      "padding",
      "white-space",
      "overflow-wrap",
      "tab-size",
    ]) {
      expect(base, `.layer must own ${property} for both layers`).toContain(property);
    }

    for (const layer of [".paint", ".control"]) {
      expect(
        css,
        `${layer} must compose .layer — a copied metric drifts the paint off the characters`,
      ).toMatch(new RegExp(`\\${layer} \\{[^}]*composes: layer;`));
    }
  });

  it("hides the control's own text and restores the caret, or the field looks empty", () => {
    const css = source();
    const control = css.match(/\.control \{([^}]*)\}/)?.[1];

    expect(control).toContain("color: transparent");
    // Without this the caret would be transparent too, and a focused empty field
    // would have no cursor in it.
    expect(control).toContain("caret-color:");
  });

  it("repaints the selection, because transparent text makes the default invisible", () => {
    // `color: transparent` applies to selected text as well, so the browser's
    // default selection would be transparent-on-highlight: selected code would
    // appear to vanish.
    const css = source();
    expect(css).toMatch(/\.control::selection \{[^}]*color:/);
  });

  it("keeps the placeholder visible, since a transparent one is no guidance at all", () => {
    const css = source();
    const placeholder = css.match(/\.control::placeholder \{([^}]*)\}/)?.[1];

    expect(placeholder, "the placeholder must not inherit color: transparent").toBeTruthy();
    expect(placeholder).not.toContain("transparent");
    expect(placeholder).toContain("color:");
  });

  it("keeps the paint out of the way of clicks and selection", () => {
    // The user selects through the transparent textarea. If the paint took
    // pointer events it would swallow every click in the field, and if it were
    // selectable, dragging would highlight code the textarea does not own and
    // the browser's own selection would disappear.
    const css = source();
    const paint_ = css.match(/\.paint \{([^}]*)\}/)?.[1];

    expect(paint_).toContain("pointer-events: none");
    expect(paint_).toContain("user-select: none");
  });
});

/**
 * The stylesheet as text, with comments removed.
 *
 * Read through Vite's `?raw` rather than `node:fs` — the app tsconfig has no
 * node types on purpose (see `theme-contrast.test.ts`). Comments are stripped
 * because these rules are heavily annotated, and several of the annotations
 * *name the property they are explaining*: the placeholder rule's comment
 * contains the word "transparent", so a matcher that read rule bodies raw would
 * find `color: transparent` in a rule whose whole point is that it does not have
 * it. Prose is not a declaration.
 */
const CSS_SOURCE = (await import("./CodeArea.module.css?raw")).default.replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
