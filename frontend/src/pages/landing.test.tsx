import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import About from "./About/About.tsx";
import Demo from "./Demo/Demo.tsx";
import Features from "./Features/Features.tsx";
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
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Enterprise")).toBeInTheDocument();
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
});