import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ProtectedRoute from "./ProtectedRoute.tsx";

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn<() => { user: unknown; initializing: boolean }>(),
}));

vi.mock("../context/AuthContext.tsx", () => ({
  useAuth: () => mockUseAuth(),
}));

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/protected"]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/protected" element={<div>Protected content</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  it("redirects to /login when unauthenticated", () => {
    mockUseAuth.mockReturnValue({ user: null, initializing: false });
    renderRoute();
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("shows a spinner while initializing", () => {
    mockUseAuth.mockReturnValue({ user: null, initializing: true });
    renderRoute();
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Checking authentication",
    );
  });

  it("renders the outlet when authenticated", () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" }, initializing: false });
    renderRoute();
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });
});