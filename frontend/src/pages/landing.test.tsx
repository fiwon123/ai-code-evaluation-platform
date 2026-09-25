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
      screen.getByText(/pytest test suites defined per challenge/i),
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
