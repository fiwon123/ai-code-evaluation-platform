import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Login from "../Login.tsx";

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
}));

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: () => mockUseAuth(),
}));

function mockAuth(overrides: Record<string, unknown> = {}) {
  mockUseAuth.mockReturnValue({
    user: null,
    initializing: false,
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn(),
    logout: vi.fn(),
    loginWithOAuth: vi.fn(),
    ...overrides,
  });
}

function renderLogin(entry: { pathname: string; state?: unknown } = { pathname: "/login" }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/challenges" element={<div>Challenges page</div>} />
        <Route path="/demo" element={<div>Demo page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Login", () => {
  it("submits credentials and navigates to challenges", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    mockAuth({ login });
    renderLogin();

    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("alice", "secret"));
    await waitFor(() =>
      expect(screen.getByText("Challenges page")).toBeInTheDocument(),
    );
  });

  it("shows an error message when credentials are rejected", async () => {
    mockAuth({
      login: vi.fn().mockRejectedValue(new Error("Invalid credentials")),
    });
    renderLogin();

    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Invalid credentials",
      ),
    );
  });

  // Regression guard for #320: a 422 used to render the Pydantic `loc` key in
  // the banner, so the login page showed "identifier: String should have at
  // least 3 characters" under a field labelled "Email or username".
  it("never shows the internal field key in the error banner", async () => {
    const { ApiError } = await import("../../services/api.ts");
    mockAuth({
      login: vi.fn().mockRejectedValue(
        new ApiError(
          422,
          "String should have at least 3 characters",
          { identifier: "String should have at least 3 characters" },
        ),
      ),
    });
    renderLogin();

    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "ab" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "whatever" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("String should have at least 3 characters");
    expect(alert).not.toHaveTextContent("identifier");
  });

  it("redirects to challenges when already logged in", () => {
    mockAuth({ user: { id: "u1" } });
    renderLogin();
    expect(screen.getByText("Challenges page")).toBeInTheDocument();
  });

  it("returns to the page the visitor came from after login", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    mockAuth({ login });
    renderLogin({ pathname: "/login", state: { from: "/demo" } });

    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(screen.getByText("Demo page")).toBeInTheDocument(),
    );
  });

  it("redirects an already-authed visitor to the return target", () => {
    mockAuth({ user: { id: "u1" } });
    renderLogin({ pathname: "/login", state: { from: "/demo" } });
    expect(screen.getByText("Demo page")).toBeInTheDocument();
  });

  it("ignores a non-internal return target", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    mockAuth({ login });
    renderLogin({
      pathname: "/login",
      state: { from: "https://evil.example/path" },
    });

    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(screen.getByText("Challenges page")).toBeInTheDocument(),
    );
  });

  it("links to the register page", () => {
    mockAuth();
    renderLogin();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  it("offers GitHub OAuth sign-in alongside the password form", () => {
    mockAuth();
    renderLogin();
    expect(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    ).toBeInTheDocument();
  });
});