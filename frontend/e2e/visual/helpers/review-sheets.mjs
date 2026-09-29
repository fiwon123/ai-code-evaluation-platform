/**
 * Review sheets: one captioned grid of frames per route, theme and viewport,
 * built at a size a vision model can actually read.
 *
 * Why this exists alongside `contact-sheet.ts`: the contact sheet is built for
 * *human* triage — 320px tiles, 12 per 4x3 sheet, so a whole run collapses into a
 * few dozen images. A vision model reading one of those sheets cannot do the
 * triage: the tile type is below legibility, and worse, it cannot reliably tell
 * which tile came from which file. Measured, not assumed — reviewing the same
 * 12-frame route three ways produced confident descriptions of a pricing page
 * from `login/scroll-0.png`, and a reviewer asked to read 12 frames bound only
 * 5 of them to the right file.
 *
 * Two changes fix that, and only the second one matters:
 *
 * 1. **Bigger cells.** 640px on desktop (half of the 1280px capture) and 541px
 *    on Pixel 7 (half of the 1082px capture), instead of 320px. Same layout
 *    maths as the contact sheet, twice the linear resolution.
 * 2. **Captions the model can read, in full.** A label burned into each cell, so
 *    the sheet is *self-labelling*: the reviewer quotes the caption it can see
 *    next to a finding, which turns attribution from a memory exercise into
 *    something checkable against the pixels. A truncated caption defeats the
 *    whole point, so the caption is measured and the type is shrunk to fit
 *    rather than cut off.
 *
 * Tiled on a canvas in the project's own Chromium, for the same reason as the
 * contact sheet: the Playwright ffmpeg is a minimal build with no `tile`, and
 * depending on it silently produced nothing.
 *
 *   node e2e/visual/helpers/review-sheets.mjs [run-dir] [out-dir]
 *
 * Defaults to the newest run under `visual-sweeps/`. Output is
 * `<out-dir>/<theme>/<viewport>/<group>.jpg`, plus a `manifest.json` recording
 * the source frames, their pixel dimensions and the run they came from.
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { chromium } from "playwright";

const THEMES = ["light", "dark"];
const VIEWPORTS = ["desktop-chromium", "pixel-7"];

/** Cell width per viewport: half the capture's native width, in both cases. */
const CELL_WIDTH = {
  "desktop-chromium": 640,
  "pixel-7": 541,
};
const COLUMNS = 2;
const LABEL_HEIGHT = 34;
const GUTTER = 10;
const SHEET_BACKGROUND = "#0b1220";
const LABEL_BACKGROUND = "#16233a";
const LABEL_FOREGROUND = "#e8eefb";
const LABEL_FONT = "600 22px sans-serif";
/** Below this the type stops being reliably legible, so we truncate instead. */
const LABEL_FONT_FLOOR = 15;
const JPEG_QUALITY = 0.92;

const runArg = process.argv[2];
const outArg = process.argv[3];

function newestRun(root) {
  const runs = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{8}-\d{6}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (runs.length === 0) {
    throw new Error(`no sweep runs under ${root} — run \`make visual-sweep\` first`);
  }
  return runs[runs.length - 1];
}

const sweepsRoot = resolve("visual-sweeps");
const runName = runArg ?? newestRun(sweepsRoot);
const runDir = join(sweepsRoot, runName);
if (!existsSync(runDir)) {
  throw new Error(`no such sweep run: ${runDir}`);
}
const outRoot = resolve(outArg ?? `visual-review-sheets/${runName}`);

const pngsIn = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".png"))
        .map((e) => e.name)
        .sort()
    : [];

const dirsUnder = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort()
    : [];

/**
 * Header text for one cell. Deliberately carries everything needed to identify
 * the frame without consulting the filename: group, frame, theme, viewport. The
 * reviewer can check a finding against this string in the image itself.
 */
function caption({ group, frame, theme, viewport }) {
  const pretty = viewport === "pixel-7" ? "Pixel 7 412px" : "Desktop 1280px";
  return `${group}/${frame.replace(/\.png$/, "")}  ·  ${theme}  ·  ${pretty}`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const manifest = { run: runName, cellWidth: CELL_WIDTH, columns: COLUMNS, sheets: [] };
let written = 0;

try {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const cellWidth = CELL_WIDTH[viewport] ?? 640;
      for (const group of dirsUnder(join(runDir, theme, viewport))) {
        const frames = pngsIn(join(runDir, theme, viewport, group));
        if (frames.length === 0) continue;

        const cells = frames.map((frame) => ({
          label: caption({ group, frame, theme, viewport }),
          data: `data:image/png;base64,${readFileSync(join(runDir, theme, viewport, group, frame)).toString("base64")}`,
        }));

        const jpeg = await renderSheet(page, cells, cellWidth);
        if (!jpeg) {
          console.warn(`skip (no frame decoded): ${theme}/${viewport}/${group}`);
          continue;
        }

        const target = join(outRoot, theme, viewport, `${group}.jpg`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, Buffer.from(jpeg, "base64"));
        written += 1;
        manifest.sheets.push({
          file: join(theme, viewport, `${group}.jpg`),
          theme,
          viewport,
          group,
          frames,
          cells: cells.map((c) => c.label),
        });
      }
    }
  }
} finally {
  await browser.close();
}

writeFileSync(join(outRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const frameCount = manifest.sheets.reduce((n, s) => n + s.frames.length, 0);
console.log(`run:    ${runName}`);
console.log(`out:    ${outRoot}`);
console.log(`sheets: ${written} (${frameCount} frames)`);
for (const sheet of manifest.sheets.slice(0, 3)) {
  console.log(`  eg:   ${sheet.file}  <- ${sheet.cells.join(" | ")}`);
}

async function renderSheet(pg, cells, cellWidth) {
  return pg.evaluate(
    async ({ cells, columns, cellWidth, geometry, type }) => {
      const decoded = await Promise.all(
        cells.map(
          (cell) =>
            new Promise((settle) => {
              const img = new Image();
              img.onload = () => settle({ img, label: cell.label });
              img.onerror = () => settle(null);
              img.src = cell.data;
            }),
        ),
      );
      // Pair each decoded image with its own label, so a frame that fails to
      // decode cannot shift every later label onto the wrong cell.
      const live = decoded.filter(Boolean);
      if (live.length === 0) return null;

      // Cell heights follow the frame's own aspect ratio, and each row is as
      // tall as its tallest cell: a desktop frame and a Pixel 7 frame have very
      // different aspect ratios, and a fixed cell crops one of them.
      const heights = live.map(({ img }) => Math.round((img.height / img.width) * cellWidth));
      const rows = Math.ceil(live.length / columns);
      const rowHeights = [];
      for (let row = 0; row < rows; row += 1) {
        const slice = heights.slice(row * columns, row * columns + columns);
        rowHeights.push(slice.length === 0 ? cellWidth : Math.max(...slice));
      }

      const gutter = geometry.gutter;
      const width = columns * cellWidth + (columns + 1) * gutter;
      const height =
        rowHeights.reduce((sum, h) => sum + h + geometry.labelHeight, 0) + (rows + 1) * gutter;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = geometry.background;
      ctx.fillRect(0, 0, width, height);

      let y = gutter;
      let index = 0;
      for (let row = 0; row < rows; row += 1) {
        const rowHeight = rowHeights[row];
        let x = gutter;
        for (let column = 0; column < columns; column += 1) {
          const cell = live[index];
          if (cell) {
            ctx.drawImage(cell.img, x, y, cellWidth, heights[index]);
            const bandY = y + heights[index];
            ctx.fillStyle = geometry.labelBackground;
            ctx.fillRect(x, bandY, cellWidth, geometry.labelHeight);
            ctx.fillStyle = geometry.labelForeground;
            ctx.textBaseline = "middle";
            // A truncated caption defeats the point of the file, so shrink the
            // type to fit the whole string before considering an ellipsis.
            const room = cellWidth - 16;
            let size = type.size;
            ctx.font = `600 ${size}px sans-serif`;
            while (ctx.measureText(cell.label).width > room && size > type.floor) {
              size -= 1;
              ctx.font = `600 ${size}px sans-serif`;
            }
            let label = cell.label;
            if (ctx.measureText(label).width > room) {
              while (label.length > 1 && ctx.measureText(`${label}…`).width > room) {
                label = label.slice(0, -1);
              }
              label = `${label}…`;
            }
            ctx.fillText(label, x + 8, bandY + geometry.labelHeight / 2);
          }
          x += cellWidth + gutter;
          index += 1;
        }
        y += rowHeight + geometry.labelHeight + gutter;
      }
      return canvas.toDataURL("image/jpeg", geometry.quality).split(",")[1] ?? null;
    },
    {
      cells,
      columns: COLUMNS,
      cellWidth,
      geometry: {
        gutter: GUTTER,
        labelHeight: LABEL_HEIGHT,
        background: SHEET_BACKGROUND,
        labelBackground: LABEL_BACKGROUND,
        labelForeground: LABEL_FOREGROUND,
        quality: JPEG_QUALITY,
      },
      type: { size: Number(/(\d+)px/.exec(LABEL_FONT)?.[1] ?? 22), floor: LABEL_FONT_FLOOR },
    },
  );
}
