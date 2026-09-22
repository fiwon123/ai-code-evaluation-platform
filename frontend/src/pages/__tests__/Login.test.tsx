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
    ...overrides,
  });
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/challenges" element={<div>Challenges page</div>} />
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

  it("redirects to challenges when already logged in", () => {
    mockAuth({ user: { id: "u1" } });
    renderLogin();
    expect(screen.getByText("Challenges page")).toBeInTheDocument();
  });

  it("links to the register page", () => {
    mockAuth();
    renderLogin();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/register",
    );
  });
});