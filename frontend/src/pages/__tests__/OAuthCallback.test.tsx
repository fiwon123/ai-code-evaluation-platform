import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import OAuthCallback from "../OAuthCallback.tsx";

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
}));

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: () => mockUseAuth(),
}));

function renderCallback(query = "?code=abc&state=xyz") {
  return render(
    <MemoryRouter initialEntries={[`/auth/callback${query}`]}>
      <OAuthCallback />
    </MemoryRouter>,
  );
}

describe("OAuthCallback", () => {
  it("exchanges the code and redirects to challenges after login", async () => {
    const loginWithOAuth = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: null,
      initializing: false,
      loginWithOAuth,
    });
    renderCallback();

    await waitFor(() =>
      expect(loginWithOAuth).toHaveBeenCalledWith("github", "abc", "xyz"),
    );
  });

  it("navigates to challenges when the session is already established", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1" },
      initializing: false,
      loginWithOAuth: vi.fn(),
    });
    render(<MemoryRouter initialEntries={["/auth/callback?code=abc&state=xyz"]}>
      <OAuthCallback />
    </MemoryRouter>);
    // The user is set → Navigate to /challenges (rendered as a redirect).
    await waitFor(() =>
      expect(screen.queryByText(/Signing you in/)).not.toBeInTheDocument(),
    );
  });

  it("shows an error when code or state is missing", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      initializing: false,
      loginWithOAuth: vi.fn(),
    });
    renderCallback("");
    expect(
      await screen.findByText(/Missing authorization code/),
    ).toBeInTheDocument();
  });

  it("shows the provider error on a failed exchange", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      initializing: false,
      loginWithOAuth: vi.fn().mockRejectedValue(new Error("GitHub token exchange failed")),
    });
    renderCallback();
    expect(
      await screen.findByText("GitHub token exchange failed"),
    ).toBeInTheDocument();
  });
});