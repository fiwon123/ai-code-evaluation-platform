import styles from "./Pagination.module.css";

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function getPageWindow(page: number, pages: number): (number | "...")[] {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }
  const window: (number | "...")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) {
    window.push("...");
  }
  for (let i = start; i <= end; i += 1) {
    window.push(i);
  }
  if (end < pages - 1) {
    window.push("...");
  }
  window.push(pages);
  return window;
}

function Pagination({ page, pages, total, pageSize, onPageChange }: PaginationProps) {
  if (pages <= 1) {
    return null;
  }

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const shownPages = getPageWindow(page, pages);

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <p className={styles.summary}>
        Showing {from}–{to} of {total}
      </p>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.control}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          ← Prev
        </button>
        {shownPages.map((entry, index) =>
          entry === "..." ? (
            <span key={`ellipsis-${index}`} className={styles.ellipsis} aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              className={`${styles.page} ${entry === page ? styles.active : ""}`}
              onClick={() => onPageChange(entry)}
              aria-current={entry === page ? "page" : undefined}
              aria-label={`Page ${entry}`}
            >
              {entry}
            </button>
          ),
        )}
        <button
          type="button"
          className={styles.control}
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next →
        </button>
      </div>
    </nav>
  );
}

export default Pagination;