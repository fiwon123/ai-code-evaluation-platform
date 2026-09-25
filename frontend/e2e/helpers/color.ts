import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Rendered-color measurement for e2e assertions.
 *
 * Two things this gets right that a naive `getComputedStyle` read does not:
 *
 * 1. **Opaque ancestor resolution.** Transparently-painted elements (table rows
 *    inherit the card, rows and cells have no background of their own) report
 *    `rgba(0, 0, 0, 0)`. Treating that as opaque compares text against black
 *    and invents ratios that do not exist on screen. So walk to the nearest
 *    ancestor that actually paints something.
 * 2. **Refuse to guess at gradients.** A gradient background has no single
 *    answer, so throw rather than silently measuring one of its stops.
 *
 * Shared by `contrast.spec.ts` (#203) and `admin.spec.ts` (#197), which both
 * need "what is actually painted behind this text, and is that readable".
 */

export interface Paint {
  color: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  text: string;
}

const channel = (value: string): number[] =>
  (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

/** WCAG relative luminance. */
function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((raw) => {
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(channel(a)), luminance(channel(b))].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/** Fully opaque, i.e. something that actually paints. */
function isOpaque(value: string): boolean {
  const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
  return (
    value !== "rgba(0, 0, 0, 0)" &&
    value !== "transparent" &&
    (parts.length < 4 || parts[3] === 1)
  );
}

/** Read an element's text color plus the nearest painted background behind it. */
export async function paint(page: Page, target: Locator): Promise<Paint> {
  const handle = await target.elementHandle();
  if (!handle) throw new Error("element not found");
  return page.evaluate((el) => {
    // `Element`, not `HTMLElement`: the walk only needs `getComputedStyle`,
    // `style.backgroundColor` and `parentElement`, all of which exist on any
    // element. The previous `el as HTMLElement` asserted more than was true and
    // hid the same error the compiler flagged in contrast.spec.ts.
    const gradientThrow = (node: Element): never => {
      throw new Error(
        `refusing to guess a gradient background for "${(el.textContent ?? "")
          .trim()
          .slice(0, 24)}" (on <${node.tagName.toLowerCase()}>)`,
      );
    };
    let node: Element | null = el;
    let background = "";
    while (node) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") {
        gradientThrow(node);
      }
      if (
        style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        style.backgroundColor !== "transparent"
      ) {
        background = style.backgroundColor;
        break;
      }
      node = node.parentElement;
    }
    if (!background) throw new Error("no opaque background found");
    const style = getComputedStyle(el);
    return {
      color: style.color,
      background,
      fontSize: parseFloat(style.fontSize),
      fontWeight: Number(style.fontWeight) || 400,
      text: (el.textContent ?? "").trim().slice(0, 24),
    };
  }, handle);
}

/** The AA threshold for this text: 3.0 for >=24px, or >=18.66px bold. */
export function aaThreshold(paint_: Paint): number {
  return paint_.fontSize >= 24 ||
    (paint_.fontSize >= 18.66 && paint_.fontWeight >= 700)
    ? 3
    : 4.5;
}

/**
 * Human-readable failure text, so a red suite says which pair failed without a
 * rerun: the element, its size/weight, both colours, the ratio and the
 * threshold. `detail` is the optional size/weight suffix.
 */
export function describeRatio(
  label: string,
  paint_: Paint,
  detail = "",
): string {
  return (
    `${label}${detail ? ` (${detail})` : ""} is ` +
    `${contrastRatio(paint_.color, paint_.background).toFixed(2)}:1 and needs ` +
    `${aaThreshold(paint_)}:1 — "${paint_.text}" in ${paint_.color} on ${paint_.background}`
  );
}

/**
 * Paint `target` and assert the text on it meets its AA threshold, with a
 * message that names the element, its size/weight, both colours, the ratio and
 * the threshold — a red e2e suite should say which pair failed without needing
 * a rerun.
 */
export async function expectReadable(
  page: Page,
  target: Locator,
  label: string,
): Promise<Paint> {
  const measured = await paint(page, target);
  expect(
    contrastRatio(measured.color, measured.background),
    describeRatio(
      label,
      measured,
      `${measured.fontSize}px/${measured.fontWeight}`,
    ),
  ).toBeGreaterThanOrEqual(aaThreshold(measured));
  return measured;
}
