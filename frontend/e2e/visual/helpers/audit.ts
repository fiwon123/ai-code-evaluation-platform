/**
 * Layout and accessibility audit: the part of a visual review that can be
 * *measured*, run against the same rendered page the frame was shot from.
 *
 * ## Why this exists at all
 *
 * A visual sweep answers "what did the page look like". It cannot answer "is the
 * text cut off", and reading 344 PNGs to find out is neither repeatable nor
 * cheap. Every rule here is a question a reviewer would otherwise answer by
 * squinting — and squinting misses the ones that are off-screen, below the fold,
 * or only wrong at 375px.
 *
 * ## What it deliberately does not do
 *
 * It does not judge taste. Spacing rhythm, visual balance, hierarchy-by-weight
 * and "does this look like the product" are the reviewer's, and no rule here
 * pretends otherwise. Nor does it re-measure contrast: `e2e/visual-consistency/
 * contrast.spec.ts` already measures WCAG ratios from *painted pixels*, which is
 * strictly better evidence than computed styles, and duplicating it here would
 * produce two answers and one of them would be worse.
 *
 * ## The evidence rule
 *
 * A finding is only worth reporting if it points at a frame somebody can open.
 * Every finding therefore carries the relative path of the frame whose page
 * produced it, measured at the instant that frame was shot — not in a separate
 * pass over a page that has since scrolled.
 */

import type { Page } from "@playwright/test";

import type { SweepTheme, SweepViewport } from "../routes";

export type AuditSeverity = "blocker" | "major" | "minor";

export interface AuditRule {
  /** Stable id. The report and the locks both refer to rules by this. */
  id: string;
  severity: AuditSeverity;
  title: string;
  /** The criterion being approximated, where there is one. */
  criterion: string;
  /** What a reviewer should do about it. */
  fix: string;
}

export const AUDIT_RULES = {
  "page-overflow-x": {
    id: "page-overflow-x",
    severity: "blocker",
    title: "Page scrolls horizontally",
    criterion: "no horizontal overflow at the swept viewport",
    fix: "Find the offending element in this finding's detail and give it a max-width or a wrapping context",
  },
  "element-overflow-x": {
    id: "element-overflow-x",
    severity: "blocker",
    title: "Element extends past the viewport",
    criterion: "no horizontal overflow at the swept viewport",
    fix: "Constrain the element or let its content wrap; an element past the right edge is unreachable",
  },
  "text-clipped": {
    id: "text-clipped",
    severity: "blocker",
    title: "Text is cut off",
    criterion: "no content clipped by an overflow:hidden ancestor",
    fix: "Remove the fixed height, or make it a scroll region, before anything else",
  },
  "content-invisible": {
    id: "content-invisible",
    severity: "blocker",
    title: "Content is painted as nothing",
    criterion: "a reveal must not be left at opacity 0",
    fix: "Check the reveal's trigger and its transition end state; this is content that exists but never arrives",
  },
  "control-unlabelled": {
    id: "control-unlabelled",
    severity: "major",
    title: "Form control has no accessible name",
    criterion: "WCAG 2.5.3 / 4.1.2 — Label in Name",
    fix: "Give it a <label for>, an aria-label, or visible text",
  },
  "image-no-alt": {
    id: "image-no-alt",
    severity: "major",
    title: "Image has no alt attribute",
    criterion: "WCAG 1.1.1 — Non-text Content",
    fix: 'alt="" if decorative, a description if it carries meaning, but the attribute must be there',
  },
  "focus-ring-absent": {
    id: "focus-ring-absent",
    severity: "major",
    title: "No visible focus indicator",
    criterion: "WCAG 2.4.7 — Focus Visible",
    fix: "Add a :focus-visible style; keyboard users currently cannot see where they are",
  },
  "heading-skip": {
    id: "heading-skip",
    severity: "minor",
    title: "Heading level skipped",
    criterion: "WCAG 1.3.1 — Info and Relationships",
    fix: "Use the next level down, or restyle — the level is structure, not size",
  },
  "no-h1": {
    id: "no-h1",
    severity: "minor",
    title: "Page has no h1",
    criterion: "one top-level heading per page",
    fix: "Promote the page's real title to h1",
  },
  "touch-target-small": {
    id: "touch-target-small",
    severity: "minor",
    title: "Touch target under 44px",
    criterion: "WCAG 2.5.5 — Target Size (AAA 44px, AA 24px)",
    fix: "Grow the hit area with padding or a pseudo-element; a 12px icon button is not a target",
  },
  "field-error-announced": {
    id: "field-error-announced",
    severity: "minor",
    title: "Field error not announced",
    criterion: "an erroring control must announce its message (aria-invalid + aria-describedby)",
    fix: "Point aria-invalid at the control and aria-describedby at the error message element",
  },
  "text-tiny": {
    id: "text-tiny",
    severity: "minor",
    title: "Text under 12px",
    criterion: "legibility at 1x",
    fix: "Raise the step in the type scale rather than the value at this one site",
  },
} as const satisfies Record<string, AuditRule>;

export type AuditRuleId = keyof typeof AUDIT_RULES;

export interface Finding {
  rule: AuditRuleId;
  severity: AuditSeverity;
  /** Route path, state id, or motion id. */
  page: string;
  theme: SweepTheme;
  viewport: SweepViewport;
  /** Relative path of the frame that shows it. */
  frame: string;
  /** The measurement, in numbers. */
  detail: string;
}

/** How a page is identified in a finding. */
export interface AuditContext {
  page: string;
  theme: SweepTheme;
  viewport: SweepViewport;
  frame: string;
}



/**
 * Frame-level rules: everything decidable from the DOM as it is right now.
 *
 * Runs in the page, so it sees real layout — the same layout the screenshot is
 * about to record — and nothing that only exists in a source file.
 */
export async function auditFrame(page: Page, ctx: AuditContext): Promise<Finding[]> {
  // A filmstrip is a frame of a *moving* page, so the rules that assume the page
  // has come to rest cannot apply to it: a reveal sampled at 30% is legitimately
  // at opacity 0, and that opacity is the entire subject of the frame. The at-rest
  // pass covers the same pages with those rules on, so nothing is lost by
  // exempting motion here — and the exemption is declared by the caller rather
  // than sniffed from a page name, so it cannot go stale.
  const atRest = !ctx.page.startsWith("motion:");
  const raw = await page.evaluate(collect, { atRest });
  return raw.map((entry) => toFinding(entry, ctx));
}

interface RawFinding {
  rule: AuditRuleId;
  detail: string;
  /** Count of the same problem on this frame, when only the first few are listed. */
  more?: number;
  /**
   * Overrides the rule's default severity for this instance.
   *
   * A rule's severity is its *floor* judgement, and a measurement can be worse:
   * a 30px touch target misses the 44px AAA target, while a 12px one fails WCAG
   * 2.5.8 at AA. Filing both as "minor" would put an AA failure in the same
   * column as a legibility nit.
   */
  severity?: AuditSeverity;
}

function toFinding(raw: RawFinding, ctx: AuditContext): Finding {
  return {
    rule: raw.rule,
    severity: raw.severity ?? AUDIT_RULES[raw.rule].severity,
    page: ctx.page,
    theme: ctx.theme,
    viewport: ctx.viewport,
    frame: ctx.frame,
    detail: raw.more ? `${raw.detail} (+${raw.more} more on this frame)` : raw.detail,
  };
}

/**
 * In-page collector. Runs for one frame; returns raw findings for the audit
 * rules that do not need the keyboard.
 */
function collect(options: { atRest: boolean }): RawFinding[] {
  // See maxPerRule: in-page code cannot read module scope.
  const maxPerRule = 4;
  /** Elements a user can put a pointer on. */
  const INTERACTIVE =
    'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [tabindex]';

  const found: RawFinding[] = [];
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const budget = new Map<string, number>();

  const report = (rule: AuditRuleId, detail: string, severity?: AuditSeverity) => {
    const seen = budget.get(rule) ?? 0;
    if (seen < maxPerRule) {
      found.push({ rule, detail, ...(severity ? { severity } : {}) });
      budget.set(rule, seen + 1);
      return;
    }
    // Already listed `maxPerRule` of these; keep the count on the last one so the
    // report says "and six more" instead of quietly under-reporting.
    budget.set(rule, seen + 1);
    for (let i = found.length - 1; i >= 0; i -= 1) {
      if (found[i]!.rule === rule) {
        found[i]!.more = (found[i]!.more ?? 0) + 1;
        break;
      }
    }
  };

  // --- geometry helpers ----------------------------------------------------

  const style = (el: Element) => getComputedStyle(el);
  const rect = (el: Element) => el.getBoundingClientRect();

  /** Rendered at all: not display:none, not visibility:hidden, occupies space. */
  const rendered = (el: Element) => {
    const s = style(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const r = rect(el);
    return r.width > 0 && r.height > 0;
  };

  /** Does it actually show? `opacity: 0` is handled separately, on purpose. */
  const visible = (el: Element) => rendered(el) && Number(style(el).opacity) > 0.05;

  const describe = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const testid = el.getAttribute("data-testid");
    const label = testid ? `[data-testid="${testid}"]` : "";
    const cls = typeof el.className === "string" && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${tag}${id}${label}${cls}${text ? ` "${text}"` : ""}`;
  };

  /**
   * Content hidden from sight on purpose, but not from a screen reader.
   *
   * The visually-hidden pattern: a 1px box clipped to nothing, holding real text
   * for assistive tech. `ComparisonMark` uses it to say "Included" / "Not
   * included" beside a glyph that says it visually (#333), and `text-clipped`
   * filed all of that as a **blocker** — 22px of text needing 1px, which is
   * precisely what the pattern is for. Four false blockers on `/pricing`, on a
   * green run, where they were the only findings the report had.
   *
   * The tell is the clip, not the size: `clip: rect(0,0,0,0)` and
   * `clip-path: inset(50%)` exist to remove content from the visual canvas while
   * leaving it in the accessibility tree. Nothing else has a reason to set them.
   * Keying on "small box" instead would exempt any cramped element, which is
   * where real clipping lives.
   *
   * What this deliberately does not do is report the hidden text as a defect
   * either. If someone ever applies this pattern to content that *should* be
   * seen, the sweep goes quiet — which is the cost of any exemption, and the
   * reason the lock below asserts the exemption in both directions rather than
   * trusting it.
   */
  const visuallyHidden = (el: Element) => {
    const s = style(el);
    return s.clip === "rect(0px, 0px, 0px, 0px)" || s.clipPath === "inset(50%)";
  };

  /** The nearest ancestor that clips, if any. */
  const clippingAncestor = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const s = style(p);
      if (/(hidden|clip)/.test(s.overflowX) || s.overflowY === "hidden" || s.overflowY === "clip") {
        return p;
      }
    }
    return null;
  };

  /** A region that scrolls on purpose, so content inside it is not "off-page". */
  const scrollableAncestor = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const s = style(p);
      if (/(auto|scroll)/.test(s.overflowX) || /(auto|scroll)/.test(s.overflowY)) return p;
    }
    return null;
  };

  const inViewport = (r: DOMRect) =>
    r.bottom > 0 && r.top < viewportHeight && r.right > 0 && r.left < viewportWidth;

  // --- rule: horizontal overflow -------------------------------------------

  const scrollWidth = document.documentElement.scrollWidth;
  if (scrollWidth > viewportWidth + 1) {
    report("page-overflow-x", `document scrollWidth ${scrollWidth}px > viewport ${viewportWidth}px`);
  }

  // --- rule: element past the right edge -----------------------------------

  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (!visible(el)) continue;
    const r = rect(el);
    if (r.right <= viewportWidth + 1) continue;
    // A region that scrolls horizontally on purpose is not an overflow bug, and
    // neither is anything inside one.
    if (scrollableAncestor(el)) continue;
    // Nor is anything an ancestor already clips. The hero's `.codeGrid` is
    // `position: absolute; inset: -20%` — decorative, deliberately wider than its
    // container, and cropped by it — and reporting it is reporting the design
    // working. `page-overflow-x` is the authority on whether anything is actually
    // off-page; this rule exists to say *which element* when it does.
    if (clippingAncestor(el)) continue;
    // An element wider than the viewport is the cause, not a symptom: report the
    // outermost such element and let it stand for its descendants.
    if (r.width > viewportWidth + 1) {
      report(
        "element-overflow-x",
        `${describe(el)} is ${Math.round(r.width)}px wide, right edge at ${Math.round(r.right)}px in a ${viewportWidth}px viewport`,
      );
      break;
    }
    report(
      "element-overflow-x",
      `${describe(el)} ends at ${Math.round(r.right)}px, ${Math.round(r.right - viewportWidth)}px past a ${viewportWidth}px viewport`,
    );
    if (found.filter((f) => f.rule === "element-overflow-x").length >= maxPerRule) break;
  }

  // --- rule: clipped text --------------------------------------------------

  for (const el of Array.from(document.querySelectorAll<HTMLElement>("p, span, li, td, th, h1, h2, h3, h4, h5, h6, a, button, label, legend, dt, dd"))) {
    if (!visible(el)) continue;
    // Screen-reader-only text is clipped on purpose, and saying so is the whole
    // content of the class. Reported, it was the only thing in the report (#337).
    if (visuallyHidden(el)) continue;
    // Only elements holding their own text; a wrapper's overflow is its text
    // children's problem and would double-report.
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent ?? "").trim())
      .join(" ")
      .trim();
    if (own.length < 4) continue;

    const s = style(el);
    const clips = /(hidden|clip)/.test(s.overflowY) || s.overflowX === "hidden" || s.overflowX === "clip";
    const ancestor = clippingAncestor(el);
    if (!clips && !ancestor) continue;
    // A cell inside an `overflow-x: auto` table extends past its wrapper's box and
    // the user scrolls to it. That is the sanctioned answer to a wide table on a
    // phone, not a cut-off label.
    if (scrollableAncestor(el)) continue;

    // Vertical: text taller than the box that is not scrollable and not
    // deliberately clamped to N lines. This is the "card that wraps badly" class.
    if (s.overflowY === "hidden" && el.scrollHeight > el.clientHeight + 1) {
      const clamped = s.webkitLineClamp && s.webkitLineClamp !== "none";
      if (!clamped) {
        report(
          "text-clipped",
          `${describe(el)} needs ${el.scrollHeight}px but has ${el.clientHeight}px and clips (${own.slice(0, 48)})`,
        );
      }
      continue;
    }
    // Horizontal single-line clipping with an ellipsis is a design decision, not
    // a defect; clipping *without* one is a sentence that stops mid-word.
    if (s.textOverflow !== "ellipsis" && s.whiteSpace === "nowrap") {
      const clipper = clips ? el : ancestor;
      if (clipper && rect(el).right > rect(clipper).right + 1) {
        report(
          "text-clipped",
          `${describe(el)} runs past its ${clipper === el ? "own" : "ancestor's"} box with no ellipsis (${own.slice(0, 48)})`,
        );
      }
    }
  }

  // --- rule: content painted as nothing ------------------------------------
  const maybeInvisible = options.atRest
    ? Array.from(document.querySelectorAll<HTMLElement>("body *"))
    : [];

  for (const el of maybeInvisible) {
    if (!rendered(el)) continue;
    const s = style(el);
    if (Number(s.opacity) > 0.05) continue;
    // A visually-hidden element is *supposed* to be invisible: screen-reader-only
    // text is 1px and clipped. That is not content that failed to arrive.
    const r = rect(el);
    if (r.width <= 24 || r.height <= 24) continue;
    if (r.width <= 2 || r.height <= 2) continue;
    if (el.getAttribute("aria-hidden") === "true") continue;
    if (!inViewport(r)) continue;
    // An element inside something already invisible adds nothing.
    let parent = el.parentElement;
    let underHidden = false;
    while (parent) {
      if (Number(style(parent).opacity) <= 0.05) {
        underHidden = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (underHidden) continue;
    report(
      "content-invisible",
      `${describe(el)} is ${Math.round(r.width)}x${Math.round(r.height)}px at opacity 0, on screen at scroll ${Math.round(window.scrollY)}`,
    );
    if (found.filter((f) => f.rule === "content-invisible").length >= maxPerRule) break;
  }

  // --- rule: unlabelled controls -------------------------------------------

  for (const el of Array.from(document.querySelectorAll<HTMLElement>("input, select, textarea"))) {
    if (!visible(el)) continue;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button" || type === "reset") continue;
    const hasLabel = Boolean(
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
        el.closest("label") ||
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        el.getAttribute("title"),
    );
    if (hasLabel) continue;
    report(
      "control-unlabelled",
      `${describe(el)}${type ? ` [type=${type}]` : ""} has no label, aria-label or aria-labelledby`,
    );
  }

  // --- rule: images without alt --------------------------------------------

  for (const el of Array.from(document.querySelectorAll<HTMLImageElement>("img"))) {
    if (!rendered(el)) continue;
    if (el.hasAttribute("alt")) continue;
    report("image-no-alt", `${describe(el)} has no alt attribute (src=${el.getAttribute("src") ?? "?"})`);
  }

  // --- rule: heading structure ---------------------------------------------

  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).filter((h) =>
    visible(h),
  );
  if (headings.length === 0) {
    report("no-h1", "the page renders no visible heading at all");
  } else if (!headings.some((h) => h.tagName === "H1")) {
    report("no-h1", `the page's first heading is <${headings[0]!.tagName.toLowerCase()}>: ${(headings[0]!.textContent ?? "").trim().slice(0, 40)}`);
  }
  let previous = 0;
  for (const heading of headings) {
    const level = Number(heading.tagName.slice(1));
    if (previous && level > previous + 1) {
      report(
        "heading-skip",
        `<h${previous}> is followed by <h${level}>: ${(heading.textContent ?? "").trim().slice(0, 40)}`,
      );
    }
    previous = level;
  }

  // --- rule: touch targets -------------------------------------------------

  for (const el of Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE))) {
    if (!visible(el)) continue;
    let r = rect(el);
    if (r.width <= 0 || r.height <= 0) continue;
    // A labelled control's target is its whole activation region — clicking the
    // label activates the control. A radio inside a styled chip-label measures
    // raw as ~13x13 while the chip is the real 44px target, so measure the
    // union of the control and its labels, exactly the box a click can land
    // on. Unlabelled controls (and inputs whose labels live elsewhere in the
    // page, like a text field with a label above it) are measured raw as
    // before — the union only ever grows the box.
    const labelled = (el as HTMLInputElement).labels;
    if (labelled && labelled.length > 0) {
      let top = r.top;
      let left = r.left;
      let bottom = r.bottom;
      let right = r.right;
      for (const lb of labelled) {
        const lr = rect(lb);
        top = Math.min(top, lr.top);
        left = Math.min(left, lr.left);
        bottom = Math.max(bottom, lr.bottom);
        right = Math.max(right, lr.right);
      }
      r = new DOMRect(left, top, right - left, bottom - top);
    }
    if (r.bottom < 0 || r.top > viewportHeight) continue;
    if ((el as HTMLInputElement).disabled) continue;
    // Inline links in a sentence are exempt from target size: the criterion is
    // about targets, and a word in a paragraph is not one.
    const inProse = el.tagName === "A" && el.closest("p, li, td, dd, figcaption") !== null;
    if (inProse) continue;
    if (r.width >= 44 && r.height >= 44) continue;
    const size = `${Math.round(r.width)}x${Math.round(r.height)}px`;
    if (r.width >= 24 && r.height >= 24) {
      // Over the AA floor, under the AAA target: a real observation about touch
      // comfort, filed as minor so it never outranks a defect.
      report(
        "touch-target-small",
        `${describe(el)} is ${size} (under the 44px AAA target, over the 24px AA floor)`,
      );
    } else {
      // Under 24px fails WCAG 2.5.8 at AA, so this instance is a major finding
      // even though the rule's default severity is minor.
      report(
        "touch-target-small",
        `${describe(el)} is ${size}, under the 24px WCAG 2.5.8 floor`,
        "major",
      );
    }
    if (found.filter((f) => f.rule === "touch-target-small").length >= maxPerRule) break;
  }

  // --- rule: field errors announced ---------------------------------------

  // A field that reports invalidity must also announce the message. The rule
  // is deliberately structural: `aria-invalid="true"` without
  // `aria-describedby` means the error text (if any) is orphaned, and a
  // describedby that points at nothing means the announcement is empty.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[aria-invalid="true"]'))) {
    if (!visible(el)) continue;
    const references = (el.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null && n !== undefined && !n.hidden);
    if (references.length === 0) {
      report(
        "field-error-announced",
        `${describe(el)} has aria-invalid but no aria-describedby that names a visible message`,
      );
      if (found.filter((f) => f.rule === "field-error-announced").length >= maxPerRule) break;
    }
  }

  // --- rule: tiny text -----------------------------------------------------

  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (!visible(el)) continue;
    const own = Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 1,
    );
    if (!own) continue;
    const size = Number.parseFloat(style(el).fontSize);
    if (size >= 12) continue;
    report("text-tiny", `${describe(el)} renders at ${size}px`);
    if (found.filter((f) => f.rule === "text-tiny").length >= maxPerRule) break;
  }

  return found;
}

/**
 * The focus-ring rule, which needs a real keyboard.
 *
 * `:focus-visible` is deliberately *not* set by `element.focus()` — a programmatic
 * focus on a non-text control reports no ring even when one is styled — so this
 * walks the tab order with real `Tab` presses. It is a page-level property, not a
 * frame-level one, so it runs once per page and the findings are attributed to
 * that page's first frame.
 *
 * It must run *after* the frames are shot: tabbing scrolls the viewport, which
 * would otherwise leave the last frame of a page captured somewhere the reviewer
 * never asked for.
 */
export async function auditFocusRings(
  page: Page,
  ctx: AuditContext,
  limit = 24,
): Promise<Finding[]> {
  const baseline = await page.evaluate(focusSignatures);
  if (baseline.length === 0) return [];

  const findings: Finding[] = [];
  const seen = new Set<number>();
  let budget = limit;

  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        signature: [
          s.outlineStyle,
          s.outlineWidth,
          s.outlineColor,
          s.outlineOffset,
          s.boxShadow,
          s.borderColor,
          s.borderWidth,
          s.backgroundColor,
          s.color,
          s.textDecorationLine,
        ].join("|"),
        label: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
      };
    });
    if (!active) continue;
    const index = baseline.findIndex((b) => b.key === active.label);
    if (index < 0 || seen.has(index)) continue;
    seen.add(index);
    if (active.signature === baseline[index]!.signature) {
      findings.push(
        toFinding(
          {
            rule: "focus-ring-absent",
            detail: `${baseline[index]!.key} is reachable by Tab and its computed outline, box-shadow, border, background and colour are identical focused and unfocused`,
          },
          ctx,
        ),
      );
    }
    if (--budget <= 0) break;
  }
  return findings;
}

/**
 * The unfocused signature of every tab stop, keyed by a description stable enough
 * to match the focused element against. An index would drift the moment focus
 * order and DOM order disagree, which is exactly what they do in a page with
 * `tabindex` or a skip link.
 */
function focusSignatures(): Array<{ key: string; signature: string }> {
  const selector =
    'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const out: Array<{ key: string; signature: string }> = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (s.visibility === "hidden" || s.display === "none") continue;
    out.push({
      key: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
      signature: [
        s.outlineStyle,
        s.outlineWidth,
        s.outlineColor,
        s.outlineOffset,
        s.boxShadow,
        s.borderColor,
        s.borderWidth,
        s.backgroundColor,
        s.color,
        s.textDecorationLine,
      ].join("|"),
    });
  }
  return out;
}
