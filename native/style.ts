// The look of the overlays and HUD: the browser build's style sheet,
// rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start with the theme the runtime's own widgets (checkboxes, selects, text
// fields, dialogs, scroll bars) take. The table theme (Settings › Theme)
// recolours everything as the old shell's CSS variables did: its colours are
// the sheet's tokens. The old sheet kept the dark panels on every theme, so
// Pinewood Morning's dark text sat on dark panels; here a light theme's
// panels are drawn from its light page colour instead, so its text reads.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";
import type { Theme } from "./render.ts";

type Tokens = Record<string, string | number>;

function hex(c: string): [number, number, number] {
  const h = c.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function toHex(rgb: readonly number[]): string {
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
/** The colour mixed into another (CSS color-mix in srgb). */
export function mix(a: string, b: string, k: number): string {
  const x = hex(a), y = hex(b);
  return toHex(x.map((v, i) => v * (1 - k) + y[i]! * k));
}
const luma = (c: string): number => { const [r, g, b] = hex(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
/** Whether a theme's page is light (Pinewood Morning). */
export const lightTheme = (t: Theme): boolean => luma(t.page) > 0.5;

/** The shell's colours for a table theme (ui.js applyTheme set them as CSS variables). */
export function themeTokens(t: Theme): Tokens {
  const light = lightTheme(t);
  const panel = light ? mix(t.page, t.text, 0.05) : "#2c2016";
  const panel2 = light ? mix(t.page, t.text, 0.11) : "#382a1c";
  return {
    felt: t.felt, wood: t.wood, wall: t.wall, accent: t.accent, select: t.select, legal: t.legal, danger: t.danger,
    text: t.text, page: t.page, panel, "panel-2": panel2, "panel-2-hover": mix(panel2, t.text, 0.06),
    line: light ? "#0000002e" : "#ffffff1f", "text-dim": t.text + "bf", "text-soft": t.text + "d9", "on-accent": "#1c1208",
  };
}

let current = "";
export function initStyles(t: Theme): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$accent" } },
    widget: { focusRing: { color: "$accent", width: 3, offset: 2 } },
    checkbox: {
      text: { color: "$text" }, minHeight: 44,
      parts: { box: { background: "$panel-2", border: { width: 1, color: "$line" }, radius: 4 }, mark: { background: "$accent" } },
    },
    select: { text: { color: "$text" }, background: "$panel-2", border: { width: 1, color: "$line" }, radius: 6.4, minHeight: 44 },
    textField: { text: { color: "$text" }, background: "$panel-2", border: { width: 1, color: "$line" }, radius: 6.4, minHeight: 44 },
    dialog: {
      background: "$panel", radius: 14.4, border: { width: 1, color: "$line" }, padding: { top: 17.6, bottom: 17.6, start: 20.8, end: 20.8 },
      shadow: { y: 18, blur: 50, color: "#0000008c" },
      parts: { backdrop: { background: "#080503b8" } },
    },
    // The title card: the dialog over the lodge key art, which is its backdrop (no dim of its own).
    ".title-card": { parts: { backdrop: { background: "#00000000" } } },
    scrollArea: { parts: { bar: { background: "$text-dim", radius: 4 } } },
    tooltip: { background: "$panel-2", text: { color: "$text" }, radius: 6, padding: 6 },
  });
  applyTheme(t);
}
/** The table theme's colours over the sheet's tokens and the runtime's widgets. */
export function applyTheme(t: Theme): void {
  const key = JSON.stringify(t);
  if (key === current) return;
  current = key;
  const k = themeTokens(t);
  ui.setTokens(k);
  ui.setTheme({
    fontSize: 16, smallSize: 14.4, headingSize: 20, padding: 8, spacing: 8, radius: 8.8,
    text: t.text, muted: t.text + "bf", panel: String(k.panel), control: String(k["panel-2"]), hovered: String(k["panel-2-hover"]),
    pressed: String(k["panel-2-hover"]), field: String(k["panel-2"]), accent: t.accent, focus: t.accent, outline: String(k.line),
  });
}
