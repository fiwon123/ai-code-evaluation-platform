import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GithubOAuthButton from "./GithubOAuthButton.tsx";

const { mockOauthAuthorize } = vi.hoisted(() => ({
  mockOauthAuthorize: vi.fn(),
}));

vi.mock("../services/api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api.ts")>();
  return {
    ...actual,
    authApi: { ...actual.authApi, oauthAuthorize: mockOauthAuthorize },
  };
});

/** The stubbed location object installed by ``vi.stubGlobal``. */
function locationStub() {
  return window.location as unknown as { assign: ReturnType<typeof vi.fn> };
}

describe("GithubOAuthButton", () => {
  beforeEach(() => {
    mockOauthAuthorize.mockReset();
    vi.stubGlobal("location", { assign: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to the provider URL when clicked", async () => {
    mockOauthAuthorize.mockResolvedValue({
      authorization_url: "https://github.com/login/oauth/authorize?state=abc",
      state: "abc",
    });
    render(<GithubOAuthButton />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));

    await waitFor(() =>
      expect(locationStub().assign).toHaveBeenCalledWith(
        "https://github.com/login/oauth/authorize?state=abc",
      ),
    );
  });

  it("reports an error when authorization cannot start", async () => {
    mockOauthAuthorize.mockRejectedValue(new Error("GitHub OAuth is not configured"));
    const onError = vi.fn();
    render(<GithubOAuthButton onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("GitHub OAuth is not configured"),
    );
    expect(locationStub().assign).not.toHaveBeenCalled();
  });
});