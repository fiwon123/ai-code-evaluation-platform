import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Gdpr from "../Gdpr/Gdpr.tsx";
import Security from "../Security/Security.tsx";
import Terms from "../Terms/Terms.tsx";
import Privacy from "../Privacy/Privacy.tsx";
import { LEGAL_DISCLAIMER, getLegalDocument } from "./content.ts";

/** Each legal page is a thin wrapper, so one render helper covers all four. */
function renderPage(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("legal content model", () => {
  it("resolves every document by its route slug", () => {
    expect(getLegalDocument("privacy").title).toBe("Privacy Policy");
    expect(getLegalDocument("terms").title).toBe("Terms of Service");
    expect(getLegalDocument("security").title).toBe("Security");
    expect(getLegalDocument("gdpr").title).toBe("GDPR & Data Protection");
  });

  it("throws on an unknown slug rather than rendering an empty page", () => {
    // A typo in a route definition should fail at import time, not render a
    // blank document in production.
    expect(() => getLegalDocument("pravacy")).toThrow(/Unknown legal document/);
  });

  it("gives every section a unique id so in-page links cannot collide", () => {
    for (const slug of ["privacy", "terms", "security", "gdpr"]) {
      const ids = getLegalDocument(slug).sections.map((section) => section.id);
      expect(new Set(ids).size, `${slug} has duplicate section ids`).toBe(ids.length);
      for (const id of ids) {
        // Anchors are interpolated into href="#id", so anything with a space or
        // a hash would produce a link that silently goes nowhere.
        expect(id, `${slug} section id "${id}" is not anchor-safe`).toMatch(
          /^[a-z0-9-]+$/,
        );
      }
    }
  });

  it("dates every document", () => {
    for (const slug of ["privacy", "terms", "security", "gdpr"]) {
      expect(getLegalDocument(slug).lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

/**
 * The documents make claims about what the software does. Those claims are the
 * whole reason the pages exist, and they rot silently: nothing fails when the
 * backend grows a rate limiter or an endpoint, the prose just becomes a lie.
 *
 * So the load-bearing claims are asserted here. Each entry is tied to the code
 * that makes it true, so a future change to either side shows up as a failing
 * test rather than as a false promise on a published page.
 */
describe("copy stays true to the code", () => {
  /** All prose in a document, flattened, for substring assertions. */
  function text(slug: string): string {
    const doc = getLegalDocument(slug);
    return doc.sections
      .flatMap((section) => [
        section.heading,
        ...(section.paragraphs ?? []),
        ...(section.bullets ?? []),
        ...(section.note ? [section.note] : []),
      ])
      .join("\n");
  }

  it("describes the rate limiter that core/rate_limit.py actually ships", () => {
    // core/rate_limit.py + api/__init__.py: enabled by default, applied to the
    // whole /api router, 60/min anonymous and 120/min authenticated per 60s.
    const security = text("security");
    expect(security).toMatch(/rate limit/i);
    expect(security).toMatch(/60 requests a minute/);
    expect(security).toMatch(/120 a minute/);
    // The old copy claimed there was none at all.
    expect(security).not.toMatch(/no built-in rate limiting/i);
  });

  it("does not claim containment is unconditional", () => {
    // services/evaluation.py falls back to a bare host subprocess when Docker is
    // unavailable, with no memory cap, CPU cap or read-only filesystem.
    const security = text("security");
    expect(security).toMatch(/ordinary process on the host/i);
    expect(security).not.toMatch(/can never harm/i);
    expect(security).not.toMatch(/always isolated/i);
  });

  it("says challenges are public while submissions are owner-scoped", () => {
    // api/challenges.py: list and get are unauthenticated and ChallengeRead
    // includes the prompt and test code. api/submissions.py filters by user_id.
    const security = text("security");
    expect(security).toMatch(/challenges are not private/i);
    expect(security).toMatch(/owner-scoped/i);
    expect(security).not.toMatch(
      /cannot read or modify another user's challenges/i,
    );
  });

  it("names every language the runner registry supports", () => {
    // services/languages.py EXECUTABLE_LANGUAGES: 13 languages.
    const security = text("security");
    for (const language of [
      "Python",
      "JavaScript",
      "TypeScript",
      "Java",
      "Go",
      "C",
      "C++",
      "Rust",
      "PHP",
      "Ruby",
      "Perl",
      "Kotlin",
      "Lua",
    ]) {
      expect(security, `Security page omits ${language}`).toContain(language);
    }
  });

  it("discloses the sign-in identity and account fields the User model stores", () => {
    // models/user.py: username, oauth_provider, oauth_id, avatar_url.
    const privacy = text("privacy");
    expect(privacy).toMatch(/username/i);
    expect(privacy).toMatch(/GitHub/i);
    expect(privacy).toMatch(/avatar/i);
  });

  it("describes the token as local storage, not a cookie", () => {
    // services/api.ts keeps the JWT in localStorage; no cookie is ever set.
    const privacy = text("privacy");
    expect(privacy).toMatch(/local storage/i);
    expect(privacy).toMatch(/sets no cookies/i);
  });

  it("does not promise self-service changes the API does not offer", () => {
    // There is no profile-update endpoint: the only user PATCH is admin-only
    // and limited to is_admin/is_active, and DELETE /api/admin/users/{id} is
    // admin-only too.
    const privacy = text("privacy");
    expect(privacy).toMatch(/no self-service/i);
    expect(privacy).not.toMatch(/from your profile settings/i);

    const gdpr = text("gdpr");
    expect(gdpr).not.toMatch(/correct their own account details/i);
  });

  it("credits only the providers that actually cost money", () => {
    // services/llm.py: demo and ollama are keyless, demo is the default.
    const terms = text("terms");
    expect(terms).toMatch(/demo provider/i);
    expect(terms).toMatch(/Ollama/i);
    expect(terms).toMatch(/Gemini/);
  });

  it("does not send reporters to a disclosure channel that does not exist", () => {
    // No .github/SECURITY.md, private vulnerability reporting is off, and the
    // repository is private — so "the repository's security advisory channel"
    // is a dead end.
    const security = text("security");
    expect(security).not.toMatch(/security advisory channel/i);
  });
});

describe("legal pages", () => {
  it.each([
    ["Privacy", <Privacy key="p" />, "Privacy Policy"],
    ["Terms", <Terms key="t" />, "Terms of Service"],
    ["Security", <Security key="s" />, "Security"],
    ["GDPR", <Gdpr key="g" />, "GDPR & Data Protection"],
  ])("renders the %s page with its title", (_name, ui, title) => {
    renderPage(ui);
    expect(
      screen.getByRole("heading", { level: 1, name: title }),
    ).toBeInTheDocument();
  });

  it.each([
    ["Privacy", <Privacy key="p" />],
    ["Terms", <Terms key="t" />],
    ["Security", <Security key="s" />],
    ["GDPR", <Gdpr key="g" />],
  ])("shows the template caveat and revision date on the %s page", (_name, ui) => {
    renderPage(ui);
    expect(screen.getByText("Template, not legal advice")).toBeInTheDocument();
    expect(screen.getByText(LEGAL_DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByText("Last updated:")).toBeInTheDocument();
  });

  it("renders every section heading on the Privacy page", () => {
    renderPage(<Privacy />);
    for (const section of getLegalDocument("privacy").sections) {
      expect(
        screen.getByRole("heading", { level: 2, name: section.heading }),
        `Privacy section "${section.heading}" is missing`,
      ).toBeInTheDocument();
    }
  });

  it("builds a table of contents whose links resolve to real anchors", () => {
    renderPage(<Terms />);
    const toc = screen.getByRole("navigation", { name: /contents/i });

    const anchors = within(toc)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(anchors.length).toBeGreaterThan(0);

    // The point of the contents rail: a target must actually exist, or the
    // link scrolls nowhere and reads as a broken page.
    for (const href of anchors) {
      expect(href).toMatch(/^#.+/);
      const id = href!.slice(1);
      expect(
        document.getElementById(id),
        `no element for anchor ${id}`,
      ).not.toBeNull();
    }
  });

  it("links to the other legal documents", () => {
    renderPage(<Privacy />);
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByRole("link", { name: "GDPR" })).toHaveAttribute(
      "href",
      "/gdpr",
    );
  });

  it("states the security limits rather than only the strengths", () => {
    renderPage(<Security />);
    // A security page listing only controls is marketing copy. This asserts
    // the honest part is present.
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /known limits/i,
      }),
    ).toBeInTheDocument();
  });

  it("marks the riskiest cases as operator actions", () => {
    renderPage(<Terms />);
    // The "replace this" notes are the whole value of a template.
    expect(
      screen.getAllByText(/template/i).length,
      "Terms should call out that it is a template needing review",
    ).toBeGreaterThan(0);
  });
});
