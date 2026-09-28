import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Pagination from "./Pagination.tsx";

function renderPagination(
  overrides: Partial<Parameters<typeof Pagination>[0]> = {},
) {
  const props = {
    page: 1,
    pages: 3,
    total: 25,
    pageSize: 10,
    onPageChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<Pagination {...props} />) };
}

describe("Pagination", () => {
  it("renders nothing for a single page", () => {
    const { container } = renderPagination({ pages: 1 });
    expect(container.innerHTML).toBe("");
  });

  it("shows the item range summary", () => {
    renderPagination({ page: 2, total: 25 });
    expect(screen.getByText("Showing 11–20 of 25")).toBeInTheDocument();
  });

  it("marks the active page with aria-current", () => {
    renderPagination({ page: 2, pages: 3 });
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("disables next on the last page", () => {
    renderPagination({ page: 3, pages: 3 });
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("disables previous on the first page", () => {
    renderPagination({ page: 1, pages: 3 });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("notifies the parent on next/previous clicks", () => {
    const { props } = renderPagination({ page: 2, pages: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(props.onPageChange).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(props.onPageChange).toHaveBeenCalledWith(3);
  });

  it("notifies the parent when a page button is clicked", () => {
    const { props } = renderPagination({ page: 1, pages: 5, total: 50 });
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(props.onPageChange).toHaveBeenCalledWith(3);
  });

  it("collapses the window with ellipses for many pages", () => {
    renderPagination({ page: 6, pages: 10, total: 100 });
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
  });
});