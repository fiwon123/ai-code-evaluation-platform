import { expect, test } from "@playwright/test";

import { AUDIT_RULES, auditFocusRings, auditFrame, type Finding } from "./helpers/audit";

/**
 * Runtime lock: the audit must fire on a defect and stay quiet on a clean page.
 *
 * This is the load-bearing test of the whole visual-sweep report. Everything else
 * in the harness can be wrong in a way that produces *fewer* findings — a rule
 * that never matches, a selector that matches nothing, an `evaluate` that
 * silently returns an empty array — and the failure is invisible: the report gets
 * shorter, the sweep still passes, and "no findings" is exactly what a broken
 * audit looks like.
 *
 * So each rule gets a fixture built to break it in one specific way, and the
 * assertion checks the rule fired **and that it fired about the element it was
 * aimed at** — a rule that fires for the wrong reason is a rule that will one day
 * fire for no reason. Then one clean page must produce *nothing*, because a rule
 * set that reports a defect on a correct page trains a reviewer to ignore it.
 *
 * The fixtures are inline HTML rather than a page in the app, deliberately: a
 * fixture that had to render through the router, the theme bootstrap and the
 * offline API mocks would be testing the app as much as the audit, and a change
 * in the app would silently move the ground under this file.
 */

const CTX = {
  page: "fixture",
  theme: "light" as const,
  viewport: "desktop-chromium" as const,
  frame: "fixture/0001.png",
};

/** Wrap a body fragment in a page that is clean apart from the fragment. */
const page_ = (body: string, head = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">${head}
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
  .box { width: 320px; }
</style></head><body>${body}</body></html>`;

const rulesFired = (findings: Finding[]) => new Set(findings.map((f) => f.rule));

test.describe("each rule fires on the defect it exists to catch", () => {
  const cases: Array<{ rule: keyof typeof AUDIT_RULES; body: string; head?: string; expect: string }> = [
    {
      rule: "page-overflow-x",
      body: `<div class="box" style="width: 2000px">wide</div>`,
      expect: "scrollWidth",
    },
    {
      rule: "element-overflow-x",
      // Wider than the 1280px desktop viewport, so it is the cause and not a symptom.
      body: `<div class="box" style="width: 1600px; margin-left: 900px">past the edge</div>`,
      expect: "1600px",
    },
    {
      rule: "text-clipped",
      body: `<p id="clipped" style="height: 20px; overflow: hidden">A sentence long enough to need three lines of vertical room in a box with room for one</p>`,
      expect: "#clipped",
    },
    {
      rule: "content-invisible",
      body: `<div id="ghost" style="opacity: 0; width: 120px; height: 80px">never arrives</div>`,
      expect: "#ghost",
    },
    {
      rule: "control-unlabelled",
      body: `<input id="orphan" type="text" />`,
      expect: "#orphan",
    },
    {
      rule: "image-no-alt",
      body: `<img id="logo" src="/favicon.svg" width="32" height="32" />`,
      expect: "#logo",
    },
    {
      rule: "heading-skip",
      body: `<h1>Top</h1><h3>Skipped straight to three</h3>`,
      expect: "<h3>",
    },
    {
      rule: "no-h1",
      body: `<h2>Only a second level</h2>`,
      expect: "first heading is <h2>",
    },
    {
      rule: "touch-target-small",
      body: `<button id="pin" style="width: 12px; height: 12px; padding: 0">x</button>`,
      expect: "#pin",
    },
    {
      rule: "text-tiny",
      body: `<p style="font-size: 9px">nine pixels</p>`,
      expect: "9px",
    },
  ];

  for (const { rule, body, head, expect: marker } of cases) {
    test(`${rule}`, async ({ page }) => {
      await page.setContent(page_(body, head));
      const findings = await auditFrame(page, CTX);
      expect(rulesFired(findings), `${rule} did not fire on its own fixture`).toContain(rule);
      // Not just "it fired" — "it fired about the thing it was aimed at". A rule
      // matching an unrelated element is a rule that will match nothing, or
      // everything, on a real page.
      const finding = findings.find((f) => f.rule === rule);
      expect(finding?.detail, `${rule} fired for the wrong element`).toContain(marker);
    });
  }
});

test.describe("a correct page produces no findings at all", () => {
  // The false-positive lock, and the one that matters most: a rule set that
  // reports a defect on a correct page gets ignored on an incorrect one.
  test("clean markup audits clean", async ({ page }) => {
    await page.setContent(
      page_(`
        <h1>Heading one</h1>
        <p style="font-size: 16px">Body copy at the type scale's floor.</p>
        <h2>A second level</h2>
        <h3>And a third</h3>
        <img id="logo" src="/favicon.svg" alt="The project" width="32" height="32" />
        <form>
          <label for="identifier">Identifier</label>
          <input id="identifier" type="text" style="height: 44px" />
          <label for="bio">Bio</label>
          <textarea id="bio" style="width: 320px; height: 88px"></textarea>
          <button type="button" style="height: 44px; padding: 0 16px">Save</button>
        </form>
        <a href="/challenges" style="display: inline-block; padding: 12px 20px">A padded link</a>
      `),
    );
    const findings = await auditFrame(page, CTX);
    expect(findings.map((f) => `${f.rule}: ${f.detail}`)).toEqual([]);
  });

  test("a screen-reader-only block is not a defect", async ({ page }) => {
    // The classic false positive: `.sr-only` text is *supposed* to be 1px and
    // invisible. An audit that reports it is reporting its own ignorance, and a
    // rule like that gets disabled rather than fixed.
    await page.setContent(
      page_(`<h1>Skip link target</h1>
        <p class="sr-only" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">Instructions for a screen reader</p>`),
    );
    const findings = await auditFrame(page, CTX);
    expect(findings.map((f) => f.rule)).not.toContain("content-invisible");
  });

  test("a single-line ellipsis is a design decision, not clipped text", async ({ page }) => {
    await page.setContent(
      page_(`<h1>Long title</h1><p class="box" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">A title far too long for three hundred and twenty pixels of box</p>`),
    );
    const findings = await auditFrame(page, CTX);
    expect(findings.map((f) => f.rule)).not.toContain("text-clipped");
  });

  test("a link in a sentence is not a touch target", async ({ page }) => {
    // WCAG 2.5.5 exempts links inline in a block of text: a word in a sentence is
    // sized by the sentence. Reporting every inline link would bury the real ones.
    await page.setContent(
      page_(`<h1>Docs</h1><p>Read the <a href="/x">handbook</a> before you start.</p>`),
    );
    const findings = await auditFrame(page, CTX);
    expect(findings.map((f) => f.rule)).not.toContain("touch-target-small");
  });

  test("a decorative element an ancestor clips is not an overflow", async ({ page }) => {
    // The hero's `.codeGrid` is `position: absolute; inset: -20%`: decorative,
    // deliberately wider than its container, and cropped by it. The first version
    // of this rule reported it as a blocker on 29 pages, which is what a rule that
    // cries wolf on the most intentional element in the design earns.
    await page.setContent(
      page_(
        `<h1>Hero</h1>
         <div style="position: relative; overflow: hidden; height: 200px">
           <div id="grid" style="position: absolute; inset: -20%; background: #eee"></div>
         </div>`,
      ),
    );
    const findings = await auditFrame(page, CTX);
    expect(findings.map((f) => f.rule)).not.toContain("element-overflow-x");
  });

  test("a cell in a horizontally scrollable table is not clipped text", async ({ page }) => {
    // A wide table on a phone is answered with `overflow-x: auto`, and the admin
    // tables do exactly that. A cell extending past its wrapper is then reachable
    // by scrolling, which is not a cut-off label.
    await page.setContent(
      page_(
        `<h1>Submissions</h1>
         <div style="width: 320px; overflow-x: auto">
           <table style="width: 900px"><tr><th>Created</th><th><button>Delete</button></th></tr></table>
         </div>`,
      ),
    );
    const findings = await auditFrame(page, CTX);
    expect(findings.map((f) => f.rule)).not.toContain("text-clipped");
  });

  test("opacity 0 in a filmstrip is the subject, not a defect", async ({ page }) => {
    // A motion frame samples a reveal mid-transition on purpose. The at-rest pass
    // covers the same page with the rule on, so the exclusion loses nothing.
    await page.setContent(
      page_(`<h1>Home</h1><div style="opacity: 0; width: 200px; height: 120px">half revealed</div>`),
    );
    const findings = await auditFrame(page, { ...CTX, page: "motion:home-scroll-reveal" });
    expect(findings.map((f) => f.rule)).not.toContain("content-invisible");
    // And the same page, at rest, is reported — the exemption is the motion pass,
    // not the rule.
    const atRest = await auditFrame(page, { ...CTX, page: "/" });
    expect(atRest.map((f) => f.rule)).toContain("content-invisible");
  });

  test("a region that scrolls on purpose is not an overflow", async ({ page }) => {
    await page.setContent(
      page_(`<h1>Wide table</h1><div style="width: 320px; overflow-x: auto"><table style="width: 1600px"><tr><td>cell</td></tr></table></div>`),
    );
    const findings = await auditFrame(page, CTX);
    expect(findings.map((f) => f.rule)).not.toContain("element-overflow-x");
  });
});

test.describe("focus rings need a real keyboard", () => {
  const button = (style: string) => `
    <style>${style}</style>
    <h1>Focus</h1>
    <button id="go" style="height: 44px; padding: 0 16px">Go</button>`;

  test("a focus ring that was turned off is reported", async ({ page }) => {
    // Note the fixture: the realistic defect is `outline: none` with nothing put
    // in its place, *not* a page with no author focus style. A page with no author
    // style still gets the user agent's ring, which is a visible focus indicator,
    // and reporting those would be reporting the browser being helpful.
    await page.setContent(
      page_(button("button { border: 1px solid #888; background: #fff; } button:focus-visible { outline: none; }")),
    );
    const findings = await auditFocusRings(page, CTX);
    expect(findings.map((f) => f.rule)).toContain("focus-ring-absent");
    expect(findings[0]?.detail).toContain("button#go");
  });

  test("an outline:none replaced by a box-shadow is not a defect", async ({ page }) => {
    // The other half of the same pattern, and the reason the rule compares
    // *computed* styles instead of looking for an outline: the indicator is still
    // there, it just is not an outline.
    await page.setContent(
      page_(
        button(
          "button:focus-visible { outline: none; box-shadow: 0 0 0 3px #06c; }",
        ),
      ),
    );
    const findings = await auditFocusRings(page, CTX);
    expect(findings.map((f) => f.rule)).not.toContain("focus-ring-absent");
  });

  test("a page with a :focus-visible style is not", async ({ page }) => {
    // And the false-positive direction: if this fires, the rule reports every
    // focusable on every page, which is the same as not having the rule.
    await page.setContent(
      page_(
        button(
          "button:focus-visible { outline: 3px solid #06c; outline-offset: 2px; }",
        ),
      ),
    );
    const findings = await auditFocusRings(page, CTX);
    expect(findings.map((f) => f.rule)).not.toContain("focus-ring-absent");
  });

  test("a focus style on :focus only is still a focus ring", async ({ page }) => {
    // `:focus` is a superset of `:focus-visible`, so this is not a false positive
    // to be tuned away: keyboard users do get the ring.
    await page.setContent(
      page_(button("button:focus { outline: 3px solid #06c; }")),
    );
    const findings = await auditFocusRings(page, CTX);
    expect(findings.map((f) => f.rule)).not.toContain("focus-ring-absent");
  });
});

test("every rule is a known rule with a severity and a fix", () => {
  // A finding whose rule is not in the table has no severity to sort by and no fix
  // to suggest, so the report would carry a row that cannot be acted on.
  for (const [id, rule] of Object.entries(AUDIT_RULES)) {
    expect(rule.id).toBe(id);
    expect(["blocker", "major", "minor"]).toContain(rule.severity);
    expect(rule.criterion.length).toBeGreaterThan(0);
    expect(rule.fix.length).toBeGreaterThan(0);
  }
});
