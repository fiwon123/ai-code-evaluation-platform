import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateChallenge from "../CreateChallenge.tsx";
import { ToastProvider } from "../../components/Toast/ToastContext.tsx";

vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router-dom")>();
  return { ...mod, useNavigate: vi.fn() };
});

vi.mock("../../services/api.ts", () => ({
  challengesApi: { create: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.name = "ApiError";
      this.status = status;
      this.detail = detail;
    }
  },
}));

const mockNavigate = vi.mocked(useNavigate);

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/challenges/new"]}>
        <Routes>
          <Route path="/challenges/new" element={<CreateChallenge />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("CreateChallenge", () => {
  beforeEach(() => {
    mockNavigate.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to Python guidance", () => {
    renderPage();

    const prompt = screen.getByLabelText(/Prompt for the LLM/) as HTMLTextAreaElement;
    expect(prompt.placeholder).toContain("Write a Python function");

    const testLabel = screen.getByLabelText(/Test code/);
    expect(screen.getByText("Test code (pytest)")).toBeInTheDocument();
    expect(testLabel).toBeDefined();
  });

  it("switches prompt and test guidance when the language changes", () => {
    renderPage();

    const language = screen.getByLabelText(/Language/) as HTMLSelectElement;
    fireEvent.change(language, { target: { value: "javascript" } });

    const prompt = screen.getByLabelText(/Prompt for the LLM/) as HTMLTextAreaElement;
    expect(prompt.placeholder).toContain("JavaScript function");

    expect(screen.getByText("Test code (node:test/assert)")).toBeInTheDocument();
    const testCode = screen.getByLabelText(
      /Test code \(node:test\/assert\)/,
    ) as HTMLTextAreaElement;
    expect(testCode.placeholder).toContain("require('assert')");
  });

  it("uses Go examples for a Go challenge", () => {
    renderPage();

    const language = screen.getByLabelText(/Language/) as HTMLSelectElement;
    fireEvent.change(language, { target: { value: "go" } });

    const prompt = screen.getByLabelText(/Prompt for the LLM/) as HTMLTextAreaElement;
    expect(prompt.placeholder).toContain("Go function twoSum");

    expect(screen.getByText("Test code (go test)")).toBeInTheDocument();
    const testCode = screen.getByLabelText(/Test code \(go test\)/) as HTMLTextAreaElement;
    expect(testCode.placeholder).toContain("func TestTwoSum");
  });
});