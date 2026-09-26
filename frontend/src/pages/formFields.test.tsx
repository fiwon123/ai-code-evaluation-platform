import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import AdminChallenges from "./Admin/AdminChallenges.tsx";
import AdminSubmissions from "./Admin/AdminSubmissions.tsx";
import AdminUsers from "./Admin/AdminUsers.tsx";
import Challenges from "./Challenges.tsx";
import Contact from "./Contact/Contact.tsx";
import CreateChallenge from "./CreateChallenge.tsx";
import Demo from "./Demo/Demo.tsx";
import EditChallenge from "./EditChallenge.tsx";
import Login from "./Login.tsx";
import Profile from "./Profile/Profile.tsx";
import Register from "./Register.tsx";
import ShareResult from "../components/ShareResult/ShareResult.tsx";
import { ToastProvider } from "../components/Toast/ToastContext.tsx";

/**
 * Form-field semantics audit (#227).
 *
 * Guards the two Lighthouse best-practice rules that were failing here:
 *
 * 1. every form field element has an `id` or a `name`, and
 * 2. every `<label for>` resolves to an element that actually exists.
 *
 * Rule 2 was genuinely broken: `CreateChallenge` wrapped a row of buttons in
 * `Field`, which emits `<label for={id}>` for an id no control ever received.
 *
 * Three things keep this test honest, because an audit that inspects nothing
 * passes just as loudly as a correct one:
 *
 * - `audit` reports a route that rendered **no** fields as a finding, so a page
 *   cannot quietly drop out of coverage (an earlier draft of this file reported
 *   1 finding across 11 routes purely because 9 of them rendered nothing).
 * - `it("audits every route")` asserts a minimum inspected-control count, so a
 *   refactor cannot hollow the audit out and still go green.
 * - `it("detects both kinds of violation")` runs the audit over a deliberately
 *   broken fixture and asserts it complains — proving a clean report means
 *   "clean", not "broken detector".
 *
 * Chromium cannot launch in the dev sandbox (no `libglib-2.0.so.0`, no sudo), so
 * this runs in jsdom via Vitest, which is part of the `make check` gate. The
 * Playwright e2e suite still covers the real browser in CI.
 */

vi.mock("../services/api.ts", () => ({
  challengesApi: {
    list: vi.fn().mockResolvedValue({
      items: [
        {
          id: "c1",
          title: "Two Sum",
          description: "d",
          prompt: "p",
          test_code: "t",
          language: "python",
          difficulty: "easy",
          owner_id: "u1",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      total: 1,
      pages: 1,
      page: 1,
      size: 20,
    }),
    get: vi.fn().mockResolvedValue({
      id: "c1",
      title: "Two Sum",
      description: "d",
      prompt: "p",
      test_code: "t",
      language: "python",
      difficulty: "easy",
      owner_id: "u1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }),
    create: vi.fn(),
    update: vi.fn(),
  },
  submissionsApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, pages: 0 }),
    create: vi.fn(),
    get: vi.fn().mockResolvedValue({ id: "s1" }),
    stats: vi.fn().mockResolvedValue({ items: [] }),
    share: vi.fn().mockResolvedValue({ share_token: "tok-123" }),
  },
  adminApi: {
    listUsers: vi.fn().mockResolvedValue({ items: [], total: 0, pages: 0 }),
    listChallenges: vi.fn().mockResolvedValue({ items: [], total: 0, pages: 0 }),
    listSubmissions: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, pages: 0 }),
    stats: vi.fn().mockResolvedValue({}),
  },
  llmApi: { models: vi.fn().mockResolvedValue([]) },
  shareApi: { create: vi.fn(), revoke: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.name = "ApiError";
      this.status = status;
      this.detail = detail;
    }
  },
}));

const authUser = {
  id: "u1",
  email: "a@b.com",
  username: "a",
  is_admin: true,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

/** Flipped per case: Login/Register render the "already signed in" branch otherwise. */
let signedIn = true;

vi.mock("../context/AuthContext.tsx", () => ({
  useAuth: () => ({
    user: signedIn ? authUser : null,
    token: signedIn ? "t" : null,
    initializing: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    loginWithOAuth: vi.fn(),
  }),
}));

interface Finding {
  route: string;
  rule: string;
  detail: string;
}

interface Coverage {
  route: string;
  fields: number;
  labels: number;
}

/** The two rules, checked against real rendered markup. */
function audit(container: HTMLElement, route: string, seen: Coverage[]) {
  const findings: Finding[] = [];
  const fields = Array.from(
    container.querySelectorAll<HTMLElement>("input, select, textarea"),
  );
  const labels = Array.from(container.querySelectorAll("label[for]"));
  seen.push({ route, fields: fields.length, labels: labels.length });

  if (fields.length === 0) {
    findings.push({
      route,
      rule: "route-not-audited",
      detail: "rendered no form field, so this route escaped the audit",
    });
  }

  for (const el of fields) {
    if (!el.id && !el.getAttribute("name")) {
      findings.push({
        route,
        rule: "field-without-id-or-name",
        detail: `<${el.tagName.toLowerCase()}> type=${el.getAttribute("type") ?? "-"} aria-label=${el.getAttribute("aria-label") ?? "-"}`,
      });
    }
  }

  for (const label of labels) {
    const target = label.getAttribute("for")!;
    // Scoped to the container on purpose: the audit must not be satisfied by an
    // id that happens to exist somewhere else in the document.
    if (!container.querySelector(`[id="${CSS.escape(target)}"]`)) {
      findings.push({
        route,
        rule: "label-for-unresolved",
        detail: `<label for="${target}"> "${(label.textContent ?? "").trim()}"`,
      });
    }
  }
  return findings;
}

const CASES: Array<[string, string, boolean, () => React.ReactElement]> = [
  ["/login", "/login", false, () => <Login />],
  ["/register", "/register", false, () => <Register />],
  ["/contact", "/contact", false, () => <Contact />],
  ["/challenges", "/challenges", true, () => <Challenges />],
  ["/challenges/new", "/challenges/new", true, () => <CreateChallenge />],
  // a real :id pattern, not the catch-all — useParams needs the segment
  [
    "/challenges/c1/edit",
    "/challenges/:id/edit",
    true,
    () => <EditChallenge />,
  ],
  ["/profile", "/profile", true, () => <Profile />],
  ["/demo", "/demo", false, () => <Demo />],
  ["/admin/users", "/admin/users", true, () => <AdminUsers />],
  ["/admin/challenges", "/admin/challenges", true, () => <AdminChallenges />],
  [
    "/admin/submissions",
    "/admin/submissions",
    true,
    () => <AdminSubmissions />,
  ],
];

async function auditAllRoutes() {
  const findings: Finding[] = [];
  const seen: Coverage[] = [];
  for (const [route, pattern, auth, element] of CASES) {
    signedIn = auth;
    const { container, unmount } = render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route
            path={pattern}
            element={<ToastProvider>{element()}</ToastProvider>}
          />
        </Routes>
      </MemoryRouter>,
    );
    // Poll inside act() until data-driven controls appear, so a loading gate is
    // not mistaken for "this page has no fields".
    await waitFor(
      () => {
        if (container.querySelector("input, select, textarea")) return;
        throw new Error("no fields yet");
      },
      { timeout: 3000 },
    ).catch(() => {});
    findings.push(...audit(container, route, seen));
    unmount();
  }
  return { findings, seen };
}

describe("form field semantics", () => {
  it("gives every form field an id or a name, and resolves every label[for]", async () => {
    const { findings } = await auditAllRoutes();
    expect(
      findings,
      findings.map((f) => `[${f.rule}] ${f.route}  ${f.detail}`).join("\n"),
    ).toEqual([]);
  }, 60000);

  it("actually inspects every route rather than passing vacuously", async () => {
    const { seen } = await auditAllRoutes();
    expect(seen).toHaveLength(CASES.length);
    // Every route must have contributed real controls, or the audit above would
    // be asserting nothing for that page.
    for (const { route, fields } of seen) {
      expect(fields, `${route} rendered no form field`).toBeGreaterThan(0);
    }
    // Guards against the audit being narrowed to a token sample by a refactor.
    const total = seen.reduce((n, c) => n + c.fields, 0);
    expect(total).toBeGreaterThanOrEqual(30);
    expect(seen.reduce((n, c) => n + c.labels, 0)).toBeGreaterThanOrEqual(20);
  }, 60000);

  it("detects both kinds of violation, so a clean report means clean", async () => {
    const { container } = render(
      <div>
        <label htmlFor="ghost">Points at nothing</label>
        <input aria-label="Nameless" />
      </div>,
    );
    const findings = audit(container, "/fixture", []);
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain("label-for-unresolved");
    expect(rules).toContain("field-without-id-or-name");
  });

  it("flags a route that rendered no fields instead of skipping it", () => {
    const { container } = render(<div>no controls here</div>);
    const findings = audit(container, "/empty", []);
    expect(findings.map((f) => f.rule)).toEqual(["route-not-audited"]);
  });

  it("covers the share-link URL field, which only exists after sharing", async () => {
    const { container } = render(<ShareResult submissionId="s1" />);
    expect(
      container.querySelector("#share-result-url"),
      "share field should appear once a link exists",
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() =>
      expect(container.querySelector("#share-result-url")).not.toBeNull(),
    );
    expect(audit(container, "/share-result", [])).toEqual([]);
  });

  it("covers the contact clipboard-failure fallback textarea", async () => {
    // The fallback only renders when the browser refuses the clipboard, which is
    // exactly what jsdom does (no navigator.clipboard) — so this is the real
    // path, not a contrived one.
    render(
      <MemoryRouter>
        <ToastProvider>
          <Contact />
        </ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Jane" },
    });
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "jane@acme.com" },
    });
    fireEvent.change(screen.getByLabelText(/^message$/i), {
      target: { value: "Hello there" },
    });
    fireEvent.click(screen.getByRole("button", { name: /prepare message/i }));

    fireEvent.click(
      await screen.findByRole("button", { name: /copy the message/i }),
    );
    const fallback = await screen.findByLabelText(/ready to copy/i);
    // The point of the audit: this control must be named, not anonymous.
    expect(fallback.id).not.toBe("");
  });
});
