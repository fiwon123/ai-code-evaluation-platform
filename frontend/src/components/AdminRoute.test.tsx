import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import AdminRoute from "./AdminRoute.tsx";

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn<() => {
    user: { id: string; is_admin: boolean } | null;
    initializing: boolean;
  }>(),
}));

vi.mock("../context/AuthContext.tsx", () => ({
  useAuth: () => mockUseAuth(),
}));

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<div>Admin content</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/" element={<div>Home page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminRoute", () => {
  it("shows a spinner while initializing", () => {
    mockUseAuth.mockReturnValue({ user: null, initializing: true });
    renderRoute();
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Checking permissions",
    );
  });

  it("redirects to /login when unauthenticated", () => {
    mockUseAuth.mockReturnValue({ user: null, initializing: false });
    renderRoute();
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("redirects to / when the user is not an admin", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", is_admin: false },
      initializing: false,
    });
    renderRoute();
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });

  it("renders the outlet for admins", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", is_admin: true },
      initializing: false,
    });
    renderRoute();
    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });
});