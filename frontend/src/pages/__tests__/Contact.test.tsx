import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Contact from "../Contact/Contact.tsx";

function renderPage() {
  return render(
    <MemoryRouter>
      <Contact />
    </MemoryRouter>,
  );
}

function fillIn() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "jane@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/Company/i), {
    target: { value: "Acme" },
  });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Hello!" },
  });
}

function prepare() {
  fillIn();
  fireEvent.click(screen.getByRole("button", { name: /Prepare message/i }));
}

/** Give `mailto:` links their names, since they have no text child quirks. */
function mailtoHref(name: RegExp) {
  const link = screen.getByRole("link", { name });
  const href = link.getAttribute("href") ?? "";
  return decodeURIComponent(href);
}

afterEach(() => {
  vi.restoreAllMocks();
  // jsdom ships no clipboard, which is the "this browser won't let us copy"
  // case. Clear any stub a test installed so the next test starts there.
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("Contact", () => {
  it("renders the contact form and info sections", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: /Get in touch/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText(/Company/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Contact info/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Sales & partnerships/i }),
    ).toBeInTheDocument();
  });

  it("warns before submitting that the page sends nothing", () => {
    renderPage();
    // The old button said "Send message" and the user had no way to know that
    // pressing it reached no server at all.
    expect(
      screen.queryByRole("button", { name: /^Send message$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Nothing is sent from this page/i),
    ).toBeInTheDocument();
  });

  // The regression this issue is about: the page used to render
  // "Message received! ✅ Thanks Jane — we'll get back to you at
  // jane@example.com shortly" after `event.preventDefault()`, with no request
  // anywhere. Any promise of a reply that nothing delivers is the bug.
  it("never claims the message was received or that a reply is coming", () => {
    renderPage();
    prepare();

    for (const lie of [
      /Message received/i,
      /we'?ll get back to you/i,
      /we will get back to you/i,
      /shortly/i,
      /thank you/i,
      /success/i,
    ]) {
      expect(screen.queryByText(lie)).not.toBeInTheDocument();
    }
    expect(
      screen.getByRole("heading", { name: /nothing has been sent yet/i }),
    ).toBeInTheDocument();
  });

  it("hands off to the visitor's own email app with subject and body prefilled", () => {
    renderPage();
    prepare();

    const href = mailtoHref(/Open it in your email app/i);
    expect(href.startsWith("mailto:hello@aicodeval.dev?")).toBe(true);
    expect(href).toContain("subject=Contact from Jane");
    expect(href).toContain("Name: Jane");
    expect(href).toContain("Email: jane@example.com");
    expect(href).toContain("Company: Acme");
    expect(href).toContain("Hello!");
    // The promise the old page made is now the visitor's to keep: the panel says
    // the draft is not sent until they press send.
    expect(
      screen.getByText(/Nothing leaves until you press send there/i),
    ).toBeInTheDocument();
  });

  it("offers a GitHub issue route that works without an email app", () => {
    renderPage();
    prepare();

    const href = mailtoHref(/Post it as a GitHub issue/i);
    expect(href.startsWith("https://github.com/")).toBe(true);
    expect(href).toContain("/issues/new?title=Contact from Jane");
    expect(href).toContain("Hello!");
    expect(
      screen.getByText(/No email app on this machine/i),
    ).toBeInTheDocument();
  });

  it("copies the message when the browser allows it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    prepare();

    fireEvent.click(screen.getByRole("button", { name: /Copy the message/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toContain("Hello!");
    expect(writeText.mock.calls[0]![0]).toContain("Email: jane@example.com");
    // Announced, not just coloured: a screen reader has to hear the outcome.
    expect(screen.getByRole("status")).toHaveTextContent(
      /Copied to your clipboard/i,
    );
  });

  it("falls back to selectable text when copying is not possible", async () => {
    // No clipboard API: exactly a browser that refuses to copy, and exactly the
    // visitor with no email app — they must not be told it worked. Note this is
    // the *reachable* case in a real browser too: `document.execCommand("copy")`
    // still exists in Chromium and returns true even when nothing is copied.
    renderPage();
    prepare();

    fireEvent.click(screen.getByRole("button", { name: /Copy the message/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "" }),
      ).toHaveTextContent(/wouldn'?t let the page copy/i),
    );
    expect(
      screen.queryByText(/Copied to your clipboard/i),
    ).not.toBeInTheDocument();
    const fallback = screen.getByLabelText(/ready to copy/i) as HTMLTextAreaElement;
    // `toHaveValue` rejects asymmetric matchers, so assert on the raw value.
    expect(fallback.value).toContain("Hello!");
    expect(fallback.value).toContain("Email: jane@example.com");
    expect(fallback.readOnly).toBe(true);
  });

  it("returns to the form with the message intact when editing", () => {
    renderPage();
    prepare();
    fireEvent.click(screen.getByRole("button", { name: /Edit the message/i }));

    expect(screen.getByLabelText("Message")).toHaveValue("Hello!");
    expect(screen.getByLabelText("Name")).toHaveValue("Jane");
  });
});
