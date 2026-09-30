import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Tooltip from "./Tooltip.tsx";

/**
 * The properties worth holding are the three WCAG 1.4.13 behaviours, plus the
 * two ways this could silently become decoration: an unreachable description,
 * and a tooltip that only exists while the pointer happens to be over it.
 *
 * Driven with `fireEvent` rather than `user-event` — the latter is not a
 * dependency here — so these are events, not a simulation of a browser.
 */

const bubbleOf = () => screen.getByRole("tooltip", { hidden: true });

/**
 * Focus a control the way the component actually hears about it.
 *
 * A bare `el.focus()` does dispatch the event, but React updates state from it
 * *outside* `act()`, so the re-render is not flushed before the next assertion —
 * the test fails with a `data-open` of `null` and an act() warning. `fireEvent`
 * is act-wrapped, so the commit happens before the assertion runs.
 */
function focus(el: HTMLElement): void {
  el.focus();
  fireEvent.focus(el);
}

function blur(from: HTMLElement, relatedTarget: HTMLElement | null = null): void {
  from.blur();
  fireEvent.blur(from, relatedTarget ? { relatedTarget } : {});
}

describe("Tooltip", () => {
  it("keeps the description resolvable while closed, so it never flickers", () => {
    // The failure mode this rules out is rendering the bubble conditionally:
    // `aria-describedby` would point at nothing until the first hover, so a
    // screen reader's description would appear and disappear with the pointer.
    render(
      <Tooltip label="Find two numbers that add up to a target.">
        <span>Find two numbers…</span>
      </Tooltip>,
    );

    const bubble = bubbleOf();
    const trigger = screen.getByText("Find two numbers…").parentElement!;
    expect(bubble).toHaveTextContent("Find two numbers that add up to a target.");
    expect(trigger).toHaveAttribute("aria-describedby", bubble.id);
    // Present in the tree, not open yet.
    expect(bubble).not.toHaveAttribute("data-open");
  });

  it("describes the focusable child, not the wrapper", () => {
    // On the wrapper the description would be lost the moment focus moved to the
    // link inside it, which is the only element that can take focus here.
    render(
      <Tooltip label="Two Sum · python">
        <a href="/challenges/1">Two Sum</a>
      </Tooltip>,
    );

    const link = screen.getByRole("link", { name: "Two Sum" });
    expect(link).toHaveAttribute("aria-describedby", bubbleOf().id);
    // A focusable trigger needs no tab stop of its own, or the reader tabs twice
    // to reach one thing.
    expect(link).not.toHaveAttribute("tabindex");
    expect(link.parentElement).not.toHaveAttribute("tabindex");
  });

  it("gives an unreachable trigger a tab stop, so the description is not decoration", () => {
    // A `title` on a bare span is invisible to a keyboard user. Rather than let
    // truncated text be undescribable, the wrapper takes the focus.
    render(
      <Tooltip label="Full description">
        <span>Truncated</span>
      </Tooltip>,
    );

    const trigger = screen.getByText("Truncated").parentElement!;
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(trigger).toHaveAttribute("aria-describedby", bubbleOf().id);
  });

  it("opens on hover", () => {
    render(
      <Tooltip label="Reads like this">
        <button type="button">Score</button>
      </Tooltip>,
    );

    const bubble = bubbleOf();
    const button = screen.getByRole("button", { name: "Score" });

    fireEvent.mouseEnter(button);
    expect(bubble).toHaveAttribute("data-open");
    fireEvent.mouseLeave(button);
    expect(bubble).not.toHaveAttribute("data-open");
  });

  it("stays open while the pointer moves onto the bubble (hoverable, 1.4.13)", () => {
    // A `:hover`-only CSS tooltip loses its content here, mid-gesture, which is
    // what teaches people to distrust tooltips. The bubble is a real element the
    // pointer can sit on, and `mouseleave` does not fire for moves within it.
    render(
      <Tooltip label="Reads like this">
        <button type="button">Score</button>
      </Tooltip>,
    );

    const bubble = bubbleOf();
    const wrapper = screen.getByRole("button", { name: "Score" }).parentElement!;

    fireEvent.mouseEnter(wrapper);
    expect(bubble).toHaveAttribute("data-open");
    // Travelling trigger -> bubble: no `mouseleave` on the wrapper, so it holds.
    fireEvent.mouseEnter(bubble);
    expect(bubble).toHaveAttribute("data-open");
    // Leaving the wrapper entirely does close it.
    fireEvent.mouseLeave(wrapper);
    expect(bubble).not.toHaveAttribute("data-open");
  });

  it("opens on focus, which is the whole reason `title` was unusable here", () => {
    render(
      <Tooltip label="Reads like this">
        <button type="button">Score</button>
      </Tooltip>,
    );

    const bubble = bubbleOf();
    const button = screen.getByRole("button", { name: "Score" });

    focus(button);
    expect(button).toHaveFocus();
    expect(bubble).toHaveAttribute("data-open");
    blur(button);
    expect(bubble).not.toHaveAttribute("data-open");
  });

  it("closes when focus leaves the widget entirely, and not before", () => {
    render(
      <div>
        <Tooltip label="Described">
          <button type="button">One</button>
        </Tooltip>
        <button type="button">Two</button>
      </div>,
    );

    const bubble = bubbleOf();
    const one = screen.getByRole("button", { name: "One" });
    const two = screen.getByRole("button", { name: "Two" });

    focus(one);
    expect(bubble).toHaveAttribute("data-open");

    // Focus landing *inside* the widget is not leaving it.
    blur(one, one);
    expect(bubble).toHaveAttribute("data-open");

    blur(one, two);
    expect(bubble).not.toHaveAttribute("data-open");
  });

  it("closes when focus is taken away with no relatedTarget to point at", () => {
    // `relatedTarget` is null whenever focus is taken *away* rather than moved:
    // the address bar, another window, the devtools, or (in jsdom) any plain
    // blur. A guard written as "not inside the wrapper" reads null as "inside"
    // and leaves the tooltip stuck open for good — which is what this component
    // did until the guard was inverted.
    render(
      <Tooltip label="Described">
        <button type="button">One</button>
      </Tooltip>,
    );

    const bubble = bubbleOf();
    const one = screen.getByRole("button", { name: "One" });

    focus(one);
    expect(bubble).toHaveAttribute("data-open");

    blur(one, null);
    expect(bubble).not.toHaveAttribute("data-open");
  });

  it("dismisses on Escape without moving focus", () => {
    // The one behaviour a hover-only tooltip cannot provide at all. Focus must
    // not move: 1.4.13 asks for dismissible *without moving focus*, so the next
    // Tab continues from where the reader was rather than rewinding.
    render(
      <div>
        <Tooltip label="Described">
          <button type="button">One</button>
        </Tooltip>
        <button type="button">Two</button>
      </div>,
    );

    const bubble = bubbleOf();
    const one = screen.getByRole("button", { name: "One" });

    focus(one);
    expect(bubble).toHaveAttribute("data-open");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(bubble).not.toHaveAttribute("data-open");
    expect(one).toHaveFocus();
  });

  it("ignores other keys", () => {
    // Only Escape dismisses, or a reader typing a space would lose the tooltip
    // they were reading.
    render(
      <Tooltip label="Described">
        <button type="button">One</button>
      </Tooltip>,
    );

    const bubble = bubbleOf();
    focus(screen.getByRole("button", { name: "One" }));
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(bubble).toHaveAttribute("data-open");
  });

  it("stops listening for Escape once closed", () => {
    // A listener left attached after close would call `setOpen` on an unmounted
    // component's state, and keep the handler alive for the rest of the session.
    const { unmount } = render(
      <Tooltip label="Described">
        <button type="button">One</button>
      </Tooltip>,
    );

    const bubble = bubbleOf();
    focus(screen.getByRole("button", { name: "One" }));
    expect(bubble).toHaveAttribute("data-open");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bubble).not.toHaveAttribute("data-open");
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();
    unmount();
  });

  it("places the bubble on the requested side", () => {
    const { rerender } = render(
      <Tooltip label="Above" placement="top">
        <span>A</span>
      </Tooltip>,
    );
    expect(bubbleOf().className).toContain("top");

    rerender(
      <Tooltip label="Below" placement="bottom">
        <span>A</span>
      </Tooltip>,
    );
    expect(bubbleOf().className).toContain("bottom");
  });

  describe("passThrough", () => {
    it("does not take pointer events, so the surface beneath stays activatable", () => {
      // WCAG 1.4.13 wants the bubble hoverable, and it stays hoverable with
      // `pointer-events: none`: the bubble lives inside the surface that opened
      // it, so the pointer travelling onto it never leaves that surface. What
      // `none` avoids is a bubble swallowing the click meant for the surface.
      const { getByRole } = render(
        <Tooltip label="a long explanation" passThrough>
          <button type="button">trigger</button>
        </Tooltip>,
      );
      expect(getByRole("tooltip", { hidden: true }).className).toMatch(/passThrough/);
    });

    it("takes pointer events by default, for a bubble that offers actions", () => {
      // The default is the opposite on purpose: a bubble with a link in it has to
      // be clickable, so opting out is the caller's decision.
      const { getByRole } = render(
        <Tooltip label="an explanation">
          <button type="button">trigger</button>
        </Tooltip>,
      );
      expect(getByRole("tooltip", { hidden: true }).className).not.toMatch(/passThrough/);
    });
  });

  describe("controlled open", () => {
    it("shows the bubble when the caller says so, without the pointer", () => {
      const { getByRole } = render(
        <Tooltip label="an explanation" open>
          <button type="button">trigger</button>
        </Tooltip>,
      );
      expect(getByRole("tooltip", { hidden: true })).toHaveAttribute("data-open");
    });

    it("reports Escape to the caller, or it would reopen on the next hover", () => {
      // Without this, pressing Escape closes the bubble, the caller still thinks
      // it is open, and the next hover turns it straight back on.
      const onOpenChange = vi.fn();
      render(
        <Tooltip label="an explanation" open onOpenChange={onOpenChange}>
          <button type="button">trigger</button>
        </Tooltip>,
      );
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("stays put when the caller keeps saying it is open", () => {
      // A controlled tooltip obeys the caller: a local Escape that the parent
      // overwrites on the next render is not a dismissal, it is a flicker.
      const { getByRole } = render(
        <Tooltip label="an explanation" open onOpenChange={() => {}}>
          <button type="button">trigger</button>
        </Tooltip>,
      );
      fireEvent.keyDown(window, { key: "Escape" });
      expect(getByRole("tooltip", { hidden: true })).toHaveAttribute("data-open");
    });
  });
});
