import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import Reveal from "./Reveal.tsx";
import styles from "./Reveal.module.css";

let instances: IntersectionObserverStub[] = [];

class IntersectionObserverStub implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = "";
  readonly scrollMargin = "";
  readonly thresholds: ReadonlyArray<number> = [0.15];
  observed: Element[] = [];
  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    instances.push(this);
  }

  observe = (element: Element) => {
    this.observed.push(element);
  };

  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = () => [];

  trigger = () => {
    this.callback(
      this.observed.map((target) => ({
        target,
        isIntersecting: true,
        intersectionRatio: 1,
      })) as IntersectionObserverEntry[],
      this,
    );
  };
}

describe("Reveal", () => {
  beforeEach(() => {
    instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders children", () => {
    render(
      <Reveal>
        <p>hello</p>
      </Reveal>,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("reveals content once the observer reports intersection", () => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

    render(
      <Reveal>
        <p>revealed later</p>
      </Reveal>,
    );
    expect(screen.getByText("revealed later").parentElement).not.toHaveClass(
      styles.visible,
    );
    act(() => {
      instances[instances.length - 1]?.trigger();
    });
    expect(screen.getByText("revealed later").parentElement).toHaveClass(
      styles.visible,
    );
  });

  it("shows content immediately when IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <Reveal>
        <p>no observer</p>
      </Reveal>,
    );
    expect(screen.getByText("no observer").parentElement).toHaveClass(
      styles.visible,
    );
  });
});