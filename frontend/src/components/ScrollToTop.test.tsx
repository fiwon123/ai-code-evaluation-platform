import { fireEvent, render, screen } from "@testing-library/react";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScrollToTop from "./ScrollToTop.tsx";

/**
 * jsdom implements neither `window.scrollTo` nor `Element.scrollIntoView` — it
 * logs "Not implemented" and does nothing. Both are stubbed here so the calls
 * can be asserted, which is the entire observable behaviour of this component.
 */
let scrollTo: ReturnType<typeof vi.fn>;
let scrollIntoView: ReturnType<typeof vi.fn>;

/** Every navigation goes through the router, as it does in the real app. */
function Harness() {
  const navigate = useNavigate();
  return (
    <div>
      <ScrollToTop />
      <Link to="/legal/privacy">Privacy</Link>
      <Link to="/legal/privacy#cookies">Privacy, cookies section</Link>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
      <Routes>
        <Route path="/" element={<h1>Home</h1>} />
        <Route
          path="/legal/:slug"
          element={
            <div>
              <h1>Legal</h1>
              <p id="cookies">Cookies section</p>
            </div>
          }
        />
      </Routes>
    </div>
  );
}

function renderApp(initial = "/") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Harness />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  scrollTo = vi.fn();
  scrollIntoView = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
  // `vi.fn()` is typed as returning `any`, which is not assignable to the DOM
  // signature; the cast is the stub, not a claim about the real method.
  Element.prototype.scrollIntoView =
    scrollIntoView as unknown as Element["scrollIntoView"];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ScrollToTop", () => {
  it("leaves the first render alone so a restored scroll position survives a reload", () => {
    renderApp();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("resets to the top on a forward navigation", async () => {
    renderApp();

    fireEvent.click(screen.getByRole("link", { name: "Privacy" }));

    expect(await screen.findByRole("heading", { name: "Legal" })).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("resets again on a second forward navigation", async () => {
    renderApp();

    fireEvent.click(screen.getByRole("link", { name: "Privacy" }));
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole("link", { name: "Privacy" }));

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("does not reset on back/forward, so the reader keeps their place", async () => {
    renderApp();

    fireEvent.click(screen.getByRole("link", { name: "Privacy" }));
    expect(scrollTo).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("scrolls a hash target into view instead of jumping to the top", async () => {
    renderApp();

    fireEvent.click(screen.getByRole("link", { name: "Privacy, cookies section" }));

    expect(await screen.findByText("Cookies section")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("falls back to the top when a hash names a section that does not exist", async () => {
    renderApp("/legal/privacy#missing");

    // First render, and the named section is not on this page.
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
