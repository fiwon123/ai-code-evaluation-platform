import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Register from "../Register.tsx";

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
    login: vi.fn(),
    register: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    ...overrides,
  });
}

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={["/register"]}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/challenges" element={<div>Challenges page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Register", () => {
  it("submits the form and navigates to challenges", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    mockAuth({ register });
    renderRegister();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith(
        "alice@example.com",
        "alice",
        "password123",
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("Challenges page")).toBeInTheDocument(),
    );
  });

  it("shows a password strength hint", () => {
    mockAuth();
    renderRegister();

    const password = screen.getByLabelText("Password");
    fireEvent.change(password, { target: { value: "short" } });
    expect(screen.getByText("Use at least 8 characters")).toBeInTheDocument();

    fireEvent.change(password, { target: { value: "longenough" } });
    expect(screen.getByText("Password looks good")).toBeInTheDocument();
  });

  it("shows an error message when registration fails", async () => {
    mockAuth({
      register: vi.fn().mockRejectedValue(new Error("duplicate")),
    });
    renderRegister();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Registration failed. Please try again.",
      ),
    );
  });

  it("redirects to challenges when already logged in", () => {
    mockAuth({ user: { id: "u1" } });
    renderRegister();
    expect(screen.getByText("Challenges page")).toBeInTheDocument();
  });

  it("links to the login page", () => {
    mockAuth();
    renderRegister();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});