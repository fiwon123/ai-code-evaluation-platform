import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Browser } from "@playwright/test";

/**
 * Contact sheets: one sheet per 4x3 block of frames, so a reviewer can triage a
 * 344-frame run in a dozen images instead of 344.
 *
 * Tiled in the project's own Chromium, on a canvas — deliberately *not* with
 * ffmpeg. The ffmpeg that ships with Playwright is a minimal build: `scale` and
 * `pad` and nothing else, with no `tile`, no `hstack`, no `overlay`. A tiling
 * filtergraph against it fails at *option parsing*, before a single frame is
 * read, so the sheets silently never existed while the code that produced them
 * reported success. Tiling on a canvas has no external dependency at all, which
 * also means the sweep needs nothing installed beyond the browser Playwright
 * already requires.
 *
 * Each cell is captioned with its frame path, because a sheet of unlabelled
 * thumbnails is a picture of *something* rather than evidence of *which*
 * something — and the label is the difference between triaging 344 frames and
 * guessing which quarter of the app to open.
 */

export interface ContactSheets {
  /** `theme/viewport` directories that produced at least one sheet. */
  tiled: string[];
  /** Why nothing was tiled, when nothing was. */
  reason: string | null;
  sheets: number;
}

const COLUMNS = 4;
const ROWS = 3;
const PER_SHEET = COLUMNS * ROWS;
const THUMB_WIDTH = 320;
const LABEL_HEIGHT = 18;

export async function buildContactSheets(
  root: string,
  browser: Browser | null,
): Promise<ContactSheets> {
  if (!browser) {
    return {
      tiled: [],
      sheets: 0,
      reason:
        "no browser available to tile with, so no contact sheets were written; every frame is still on disk",
    };
  }

  const tiled: string[] = [];
  let sheets = 0;
  const page = await browser.newPage();
  try {
    for (const theme of await themesUnder(root)) {
      for (const viewport of await themesUnder(join(root, theme))) {
        // Every directory under the viewport: routes, states, motion. Grouped by
        // the tree, so a reviewer opens one file per theme and viewport and sees
        // the same grouping the manifest counts.
        for (const group of await themesUnder(join(root, theme, viewport))) {
          const dir = join(theme, viewport, group);
          const pngs = (await pngsIn(join(root, dir))).sort();
          if (pngs.length === 0) continue;
          const written = await tile(root, dir, pngs, page);
          sheets += written;
          tiled.push(dir);
        }
      }
    }
  } finally {
    await page.close();
  }
  return { tiled, sheets, reason: null };
}

async function tile(root: string, dir: string, pngs: string[], page: import("@playwright/test").Page): Promise<number> {
  const out = join(root, "contact-sheet", dir);
  await mkdir(out, { recursive: true });

  const images = await Promise.all(
    pngs.map(async (rel) => ({
      label: rel.replace(/\.png$/, ""),
      data: `data:image/png;base64,${(await readFile(join(root, dir, rel))).toString("base64")}`,
    })),
  );

  let written = 0;
  for (let sheet = 0; sheet * PER_SHEET < images.length; sheet += 1) {
    const block = images.slice(sheet * PER_SHEET, (sheet + 1) * PER_SHEET);
    const jpeg = await renderSheet(page, block);
    if (!jpeg) continue;
    const target = join(out, `sheet-${String(sheet + 1).padStart(2, "0")}.jpg`);
    await writeFile(target, Buffer.from(jpeg, "base64"));
    written += 1;
  }
  return written;
}

/**
 * Draw one sheet and return it as base64 JPEG.
 *
 * Row heights are the tallest cell in that row rather than a fixed number,
 * because a desktop frame and a Pixel 7 frame have different aspect ratios and a
 * fixed cell crops one of them. Cells that a short row leaves empty get a panel
 * background, so an incomplete grid reads as "there were fewer frames here"
 * instead of as missing pixels.
 */
async function renderSheet(
  page: import("@playwright/test").Page,
  block: Array<{ label: string; data: string }>,
): Promise<string | null> {
  return page.evaluate(
    async ({ cells, columns, rows, thumbWidth, labelHeight }) => {
      const decoded = await Promise.all(
        cells.map(
          (cell) =>
            new Promise<HTMLImageElement | null>((resolve) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = () => resolve(null);
              img.src = cell.data;
            }),
        ),
      );
      const live = decoded.filter((img): img is HTMLImageElement => img !== null);
      if (live.length === 0) return null;

      const heights = live.map((img) => Math.round((img.height / img.width) * thumbWidth));
      const rowHeights: number[] = [];
      for (let row = 0; row < rows; row += 1) {
        const slice = heights.slice(row * columns, row * columns + columns);
        rowHeights.push(slice.length === 0 ? thumbWidth : Math.max(...slice));
      }
      const gutter = 4;
      const width = columns * thumbWidth + (columns + 1) * gutter;
      const height =
        rowHeights.reduce((sum, h) => sum + h + labelHeight, 0) + (rows + 1) * gutter;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, width, height);

      let y = gutter;
      let index = 0;
      for (let row = 0; row < rows; row += 1) {
        const rowHeight = rowHeights[row]!;
        let x = gutter;
        for (let column = 0; column < columns; column += 1) {
          const img = decoded[index];
          const cell = cells[index];
          if (img) {
            ctx.drawImage(img, x, y, thumbWidth, heights[index]!);
            ctx.fillStyle = "#111c2e";
            ctx.fillRect(x, y + heights[index]!, thumbWidth, labelHeight);
            ctx.fillStyle = "#c8d6ea";
            ctx.font = "12px sans-serif";
            ctx.textBaseline = "middle";
            const label = cell?.label ?? "";
            // Clipped to the cell: a long path is truncated with an ellipsis
            // rather than bleeding into the next thumbnail's caption.
            const room = Math.floor(thumbWidth / 6.5);
            ctx.fillText(
              label.length > room ? `${label.slice(0, room - 1)}…` : label,
              x + 4,
              y + heights[index]! + labelHeight / 2 + 1,
            );
          }
          x += thumbWidth + gutter;
          index += 1;
        }
        y += rowHeight + labelHeight + gutter;
      }
      return canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? null;
    },
    {
      cells: block,
      columns: COLUMNS,
      rows: ROWS,
      thumbWidth: THUMB_WIDTH,
      labelHeight: LABEL_HEIGHT,
    },
  );
}

async function themesUnder(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((e) => e.name);
}

async function pngsIn(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".png")).map((e) => e.name);
}
