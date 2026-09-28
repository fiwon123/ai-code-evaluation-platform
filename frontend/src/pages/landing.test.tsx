import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import About from "./About/About.tsx";
import Demo from "./Demo/Demo.tsx";
import Features from "./Features/Features.tsx";
import Home from "./Home/Home.tsx";
import Pricing from "./Pricing/Pricing.tsx";

vi.mock("../services/api.ts", () => ({
  challengesApi: { list: vi.fn().mockResolvedValue([]) },
  submissionsApi: { create: vi.fn(), get: vi.fn() },
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

vi.mock("../context/AuthContext.tsx", () => ({
  useAuth: () => ({
    user: null,
    token: null,
    initializing: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    loginWithOAuth: vi.fn(),
  }),
}));

describe("landing pages", () => {
  it("renders the Features page", () => {
    render(
      <MemoryRouter>
        <Features />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /Features/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/production-shaped evaluation pipeline/i)).toBeInTheDocument();
    expect(
      screen.getByText(/test suites defined per challenge/i),
    ).toBeInTheDocument();
  });

  it("renders the Pricing page with three tiers", () => {
    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /Simple, transparent pricing/i }),
    ).toBeInTheDocument();
    // Each tier name appears on its pricing card and in the comparison table.
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pro").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enterprise").length).toBeGreaterThan(0);
    expect(screen.getByText(/Most popular/i)).toBeInTheDocument();
  });

  it("renders the Demo page with walkthrough and live section", () => {
    render(
      <MemoryRouter>
        <Demo />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /See how it works/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Create a challenge/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Try it live/i)).toBeInTheDocument();
    expect(screen.getAllByText(/demo provider/i).length).toBeGreaterThan(0);
  });

  it("renders the About page", () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /About this project/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/open-source platform/i)).toBeInTheDocument();
    expect(screen.getByText("FastAPI")).toBeInTheDocument();
  });


  it("renders the Home hero with the animated sample report", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("img", { name: "Sample score 88 / 100" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Sample evaluation report"),
    ).toBeInTheDocument();
    expect(screen.getByText("✓ two_sum_basic")).toBeInTheDocument();
    expect(screen.getByText("✗ two_sum_unsorted")).toBeInTheDocument();
  });

  it("renders the Home stats strip and guest teaser", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(screen.getByText("Sample figures for the prototype")).toBeInTheDocument();
    expect(screen.getByText("Languages supported")).toBeInTheDocument();
    expect(screen.getByText("LLM providers")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "See a sample evaluation — no account needed",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Try the live demo")).toBeInTheDocument();
  });
});

/**
 * The landing pages make promises about what the platform guarantees. Those
 * promises are the kind of copy that creeps back in during a rewrite, and a
 * guarantee the code does not make is a support ticket later. These assertions
 * are deliberately about the *rendered* pages rather than the copy constants,
 * so a page cannot be fixed in one place and left stale in another.
 *
 * The Home page is excluded here: its copy is corrected in #221, which
 * rewrites the hero. It is asserted there instead.
 */
describe("landing copy does not over-promise", () => {
  const pages = [
    ["Features", <Features key="f" />],
    ["Pricing", <Pricing key="p" />],
    ["About", <About key="a" />],
    ["Demo", <Demo key="d" />],
  ] as const;

  it.each(pages)("%s makes no unconditional safety guarantee", (_name, page) => {
    render(<MemoryRouter>{page}</MemoryRouter>);
    const text = document.body.textContent ?? "";
    // services/evaluation.py falls back to a host subprocess with no caps when
    // Docker is unavailable, so no page may claim a solution cannot escape.
    expect(text).not.toMatch(/can never/i);
    expect(text).not.toMatch(/never harm/i);
    expect(text).not.toMatch(/cannot harm/i);
    expect(text).not.toMatch(/guarantee[ds]? (?:your )?safety/i);
  });

  it.each(pages)("%s does not claim a single-language platform", (_name, page) => {
    render(<MemoryRouter>{page}</MemoryRouter>);
    const text = document.body.textContent ?? "";
    // Thirteen languages ship (services/languages.py). "a pytest suite" as the
    // only description understates the platform by eight languages.
    expect(text).not.toMatch(/a pytest test suite/i);
    expect(text).not.toMatch(/pytest test suites defined per challenge/i);
  });

  it("does not list shipped features as roadmap items", () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>,
    );
    // Scoped to the sentence that makes the roadmap claim. Docker sandbox
    // execution and self-hosting both ship, so they belong in the "functional"
    // list — it is only wrong for them to sit in the "on the roadmap" one.
    const roadmapParagraph = (document.body.textContent ?? "")
      .split(/(?<=\.)\s+/)
      .find((sentence) => /on the roadmap/i.test(sentence));
    expect(roadmapParagraph, "About page no longer states a roadmap").toBeDefined();
    expect(roadmapParagraph).not.toMatch(/Docker sandbox/i);
    expect(roadmapParagraph).not.toMatch(/self-hosting/i);
  });
});

