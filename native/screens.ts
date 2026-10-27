// The browser build's DOM shell (index.html + js/ui.js) as starhermit:ui,
// built every frame: the top bar (the game's name, the status line — the
// account and sync state on the title, the turn, rolls left, round and table
// in play, the blizzard clock — and the Pause / Help / Settings buttons), the
// scorecard rail (the current player's card with each open category's
// preview, the legal ones marked ◆, the upper/bonus/lower totals and the
// upper-bonus meter), the table rail (the seats and their totals, the
// Actions stack), the stage over the 3D table (the lesson banner, the action
// tray, the dice tray, the 3-2-1 countdown), the overlays (the title over the
// lodge key art; Practice, Learn, Journey, Challenges, Help & Rules,
// Settings, Profile & Scores, Paused, Results and confirmations) and the
// toast and sound captions. The browser's media queries are layouts picked
// by the window's logical size: wide (≥ 1024 px: the rails beside the
// stage), narrow portrait (the rails are drawers behind the Card / Table
// buttons, a thumb tray of Roll / Hint / Undo at the bottom, the dice above
// it), narrow landscape (drawers, the dice in a column at the right, the
// tray at the bottom left); the left-handed option swaps the drawer buttons.
import { frame, openMenu } from "starhermit:engine";
import { bindingLabel, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { CHALLENGES, CONTENT_VERSION, JOURNEY, LESSONS, PRACTICE_DIFFICULTIES, THEMES, TRAILS } from "../js/content.js";
import { CATEGORIES, UPPER_BONUS, UPPER_BONUS_THRESHOLD, listLegalActions, previewScores, totalsBreakdown, upperProgress } from "../js/rules.js";
import { ACHIEVEMENTS } from "../js/progress.js";
import { N, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  app, closeModal, copyInvite, dailyDef, defTitle, leaderboardLine, leaveTable, loadBoard, nextStage, openModal,
  options, playAgain, playerName, practice, resumeSaved, resumeTable, session, setGuestName, showTitle, signIn, startContent,
  statusLine, syncLabel, theme, toast, togglePause, topModal, tryHint, tryHold, tryRoll, tryScore, tryUndo, type Def, type Modal, type State,
} from "./main.ts";
import { lightTheme } from "./style.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; wide: boolean; portrait: boolean; phone: boolean; short: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, ox: sa.left / sc, oy: sa.top / sc, wide: lw >= 1024, portrait: lh >= lw, phone: lw < 560, short: lh < 500 };
}
const lastHeight = new Map<string, number>();
const pr = (): ui.UiPreferences => ui.preferences();
function textWidth(text: string, style: string | readonly string[], kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: typeof style === "string" ? style : [...style] }).width / pr().scale;
}
const buttonWidth = (text: string, style: readonly string[]): number => textWidth(text, style, "button") + 4;

interface Btn { id: string; text: string; label?: string; style?: string[]; disabled?: boolean; act: () => void; width?: number }
const PLAIN = ["btn"];
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? PLAIN;
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  const s: ui.Style = width != null ? { width } : {};
  if (width != null && buttonWidth(b.text, style) > width) {
    const inner = Math.max(20, width - 34);
    opts.content = () => { ui.style({ text: { align: "center" } }).paragraph(b.text, inner); };
  } else if (b.label && b.label !== b.text) opts.content = () => { ui.style({ text: { weight: "600" } }).label(b.text); };
  if (ui.style(...style, s).id(b.id).button(b.label ?? b.text, opts)) b.act();
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, align: "start" | "center" | "end" = "center", gap = 8): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? PLAIN));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, b.width ?? (bw(b) >= width ? width : null));
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, align, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "body", id?: string, center = false): void {
  if (!text) return;
  const styles: (string | ui.Style)[] = [cls];
  if (center) styles.push({ text: { align: "center" } });
  let u = ui.style(...styles);
  if (id) u = u.id(id);
  if (ui.measureText(text, { style: styles }).width / pr().scale <= width) u.label(text);
  else u.paragraph(text, width);
}
/** Cuts a single line to fit `width` with an ellipsis (CSS text-overflow). */
function ellipsize(text: string, width: number, cls: string): string {
  if (textWidth(text, cls) <= width) return text;
  let s = text;
  while (s.length > 1 && textWidth(s + "…", cls) > width) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}
/** Words that fit `width` on each of at most `lines` lines (the last one ellipsized). */
function wrapLines(text: string, width: number, cls: string, lines: number): string[] {
  const words = text.split(" ");
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i]!;
    if (textWidth(next, cls) <= width || !cur) { cur = next; continue; }
    out.push(cur);
    cur = words[i]!;
    if (out.length === lines - 1) { cur = words.slice(i).join(" "); break; }
  }
  out.push(cur);
  if (out.length > lines) out.length = lines;
  out[out.length - 1] = ellipsize(out[out.length - 1]!, width, cls);
  return out;
}
/** An image cover-fitted into a box with rounded corners (the panel colour while it loads). */
function art(id: string, path: string, w: number, h: number, radius: number): void {
  ui.id(id).widget("", {
    role: "none", size: { width: w, height: h },
    draw: (r) => draw.box(r.x, r.y, r.width, r.height, { background: [{ image: path, size: "cover" }, "#2c2016"], radius, border: { width: 1, color: "#ffffff1f" } }),
  });
}
/** A table cell `width` wide (the old <td>, text-align left or right). */
function cell(id: string, text: string, width: number, cls = "cell", right = false): void {
  ui.column(id, () => { ui.style(cls).label(ellipsize(text, width - 4, cls)); }, { width, align: right ? "end" : "start" });
}
const keyName = (action: string): string => (bindingLabel(action, "keyboard") || "—").replace(/^Arrow /, "").replace(/^Escape$/, "Esc");

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  const t = theme();
  // The safe-area margins (the 3D table fills the window behind the UI).
  const sa = f.safeArea;
  if (sa.top > 0) draw.rect(0, 0, f.width, sa.top, t.page);
  if (sa.bottom > 0) draw.rect(0, f.height - sa.bottom, f.width, sa.bottom, t.wall);
  if (sa.left > 0) draw.rect(0, 0, sa.left, f.height, t.page);
  if (sa.right > 0) draw.rect(f.width - sa.right, 0, sa.right, f.height, t.page);
  const top = topBar(L);
  const rw = L.wide ? { l: 320, r: 300 } : { l: 0, r: 0 };
  const stage = { x: rw.l, y: top, w: Math.max(40, L.lw - rw.l - rw.r), h: Math.max(40, L.lh - top) };
  app.stage = { x: L.ox + stage.x, y: L.oy + stage.y, w: stage.w, h: stage.h };
  render.setStage(L.ox + stage.x, L.oy + stage.y, stage.w, stage.h, f.width / L.sc, f.height / L.sc);
  const st = app.hud ? session.state : null;
  if (L.wide) {
    rail("left", L, 0, top, rw.l, L.lh - top, st);
    rail("right", L, L.lw - rw.r, top, rw.r, L.lh - top, st);
  }
  if (st) stageHud(L, stage, st);
  if (app.modals.includes("title")) titlePage(L);
  dialogs(L);
  toastAndCaption(L, stage);
}

// ------------------------------------------------------------------ top bar
function topBar(L: Layout): number {
  const narrowPortrait = !L.wide && L.portrait;
  const r = ui.place("topbar", { anchor: "top-start", x: 0, y: 0 }, () => {
    ui.row("topbar-row", () => {
      if (!narrowPortrait) ui.style("game-title").id("game-title").label("Five Dice");
      const btns = (app.hud ? 3 : 2) * 50;
      const tw = Math.max(40, L.lw - 28.8 - btns - (narrowPortrait ? 0 : textWidth("Five Dice", "game-title") + 12) - 12);
      const text = app.hud ? hudStatus() : statusLine();
      if (narrowPortrait) {
        ui.column("status-col", () => {
          wrapLines(text, tw, "status-sm", 2).forEach((line, i) => ui.style("status-sm").id(`status-${i}`).label(line));
        }, { width: tw, spacing: 0 });
      } else ui.column("status-col", () => { ui.style("status").id("session-status").label(ellipsize(text, tw, "status")); }, { width: tw });
      ui.spacer();
      if (app.hud) {
        if (ui.style("icon-btn").id("btn-pause").widget(T("Pause"), {
          role: "button", size: { width: 44, height: 44 },
          draw: (q, s) => {
            const k = s.scale;
            const c = s.colors.text;
            draw.rect(q.x + q.width / 2 - 6 * k, q.y + q.height / 2 - 8 * k, 3.2 * k, 16 * k, c);
            draw.rect(q.x + q.width / 2 + 2.8 * k, q.y + q.height / 2 - 8 * k, 3.2 * k, 16 * k, c);
          },
        }).activated) togglePause();
      }
      if (ui.style("icon-btn").id("btn-help-top").button(T("Help"), { content: () => ui.label("?") })) { if (!topModal() || topModal() === "title") openModal("help"); }
      if (ui.style("icon-btn").id("btn-settings-top").button(T("Settings"), { content: () => ui.label("⚙") })) { if (!topModal() || topModal() === "title") openModal("settings"); }
    }, { width: L.lw - 28.8, height: narrowPortrait ? 52 : 44, align: "center", spacing: 12 });
  }, { style: "topbar", width: L.lw });
  return r.height / L.sc;
}
function hudStatus(): string {
  const st = session.state!;
  const me = st.players[st.current]!;
  const vars = { name: playerName(me.name), rolls: st.rollsLeft, round: st.round, table: defTitle(session.def) };
  let s = me.isAI ? T("{name} (AI) to act · rolls left {rolls} · round {round} — {table}", vars)
    : me.name === "You" ? T("Your turn · rolls left {rolls} · round {round} — {table}", vars)
      : T("{name} to act · rolls left {rolls} · round {round} — {table}", vars);
  if (st.limits.totalMs != null) {
    const remain = Math.max(0, st.limits.totalMs - session.nowMs());
    s += ` · ⏱ ${Math.floor(remain / 60000)}:${String(Math.floor(remain / 1000) % 60).padStart(2, "0")}`;
  }
  return s;
}

// ------------------------------------------------------------------ rails
function rail(side: "left" | "right", L: Layout, x: number, y: number, w: number, h: number, st: State | null, drawer = false): void {
  const key = `rail-${side}`;
  // A drawer keeps its top clear of the Card / Table buttons over it.
  const gap = drawer ? 50 : 0;
  ui.place(key, { anchor: "top-start", x, y }, () => ui.column(`${key}-col`, () => {
    if (!st) return;
    const inner = w - 22.4;
    const avail = h - 22.4 - gap;
    const ch = lastHeight.get(key) ?? 0;
    const scroll = ch > avail;
    const cw = inner - (scroll ? 12 : 0);
    if (gap) ui.column(`${key}-gap`, () => undefined, { height: gap, width: inner });
    const body = (): void => {
      const r = ui.column(`${key}-body`, () => (side === "left" ? scorecard(st, cw, avail) : tableRail(st, cw)), { width: cw, spacing: 0 });
      lastHeight.set(key, r.height / L.sc);
    };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner, height: avail }, body);
    else body();
  }, { style: `rail-${side}`, width: w, height: h, spacing: 0 }), { width: w });
}
function scorecard(st: State, w: number, avail: number): void {
  const me = st.players[st.current]!;
  const legal = listLegalActions(st) as { scoreable: string[] };
  const previews = previewScores(st) as Record<string, number>;
  const humanTurn = session.isHumanTurn();
  const canScore = humanTurn && st.hasRolled;
  const scoreable = new Set(legal.scoreable);
  const t = theme();
  const filled = Object.values(me.scores).filter((v) => v != null).length;
  const total = Object.keys(me.scores).length;
  const capText = me.name === "You" ? T("Your card — {filled}/{total} filled", { filled, total }) : T("{name}'s card — {filled}/{total} filled", { name: playerName(me.name), filled, total });
  ui.column("card-cap", () => para(capText, w, "card-caption", "card-caption"), { width: w, padding: { bottom: 4.8 } });
  let section = "";
  const blocked = !!app.countdown;
  // Rows shrink (down to 24 px) so the whole card fits a short rail or drawer without scrolling.
  const rows = CATEGORIES.length - st.disabledCategories.length;
  const rowH = Math.max(24, Math.min(39, (avail - 150) / rows));
  const compact = rowH < 34;
  let act: (() => void) | null = null;
  for (const cat of CATEGORIES as { id: string; name: string; desc: string; section: string }[]) {
    if (st.disabledCategories.includes(cat.id)) continue;
    if (cat.section !== section) {
      section = cat.section;
      ui.column(`sec-${section}`, () => ui.style("section-head").label(section === "upper" ? T("Upper — face totals") : T("Lower — hands")), { width: w, padding: { top: compact ? 4 : 8, bottom: compact ? 2 : 4.5, start: 6.4 } });
    }
    const closed = me.scores[cat.id];
    const pv = previews[cat.id];
    const isLegal = canScore && scoreable.has(cat.id);
    // A legal row is named "Score Beams" and read on with its points and rule ("15 points. Total of 5s").
    const label = closed != null ? `${T(cat.name)} ${closed}` : isLegal ? T("Score {cat}", { cat: T(cat.name) })
      : `${T(cat.name)} — ${T(cat.desc)}${st.hasRolled ? "" : " " + T("(roll first)")}`;
    const res = ui.id(`cat-${cat.id}`).widget(label, {
      role: closed != null ? "none" : "button", size: { width: w, height: rowH }, disabled: closed == null && (!isLegal || blocked),
      description: isLegal ? `${T("{n} points", { n: pv ?? 0 })}. ${T(cat.desc)}` : T(cat.desc),
      draw: (q, s) => {
        const k = s.scale;
        const midY = q.y + q.height / 2 - 14.7 * 0.62 * k;
        const name = T(cat.name);
        const fs = 14.7 * k;
        if (closed != null) {
          draw.text(name, q.x + 6.4 * k, midY, { size: fs, color: t.text + "a6" });
          draw.text(String(closed), q.x + q.width - 6.4 * k, midY, { size: fs, color: t.text + "a6", align: "end" });
          return;
        }
        const btnW = q.width * 0.72;
        if (isLegal && (s.hovered || s.focused)) draw.box(q.x, q.y + 2 * k, btnW, q.height - 4 * k, { background: String(lightTheme(t) ? "#00000014" : "#382a1c"), radius: 5.6 });
        const dim = isLegal ? t.text : t.text + "bf";
        draw.text(name, q.x + 6.4 * k, midY, { size: fs, color: dim });
        draw.text(pv != null ? String(pv) : "·", q.x + btnW * 0.66, midY, { size: fs, color: isLegal ? t.legal : dim, weight: isLegal ? "700" : "400", align: "end" });
        if (isLegal) draw.text("◆", q.x + btnW - 10 * k, midY, { size: fs, color: t.legal, align: "end" });
        if (pv != null && !isLegal) draw.text(String(pv), q.x + q.width - 6.4 * k, midY, { size: fs, color: dim, align: "end" });
      },
    });
    if (res.activated && isLegal && !blocked) act = () => tryScore(cat.id);
  }
  const b = totalsBreakdown(me.scores) as { upper: number; bonus: number; lower: number; grand: number };
  ui.row("totals", () => {
    ui.style("cell-strong").label(ellipsize(T("Upper {upper} · Bonus {bonus} · Lower {lower}", b), w - 70, "cell-strong"));
    ui.spacer();
    ui.style("cell-strong").id("grand-total").label(`Σ ${b.grand}`);
  }, { style: "totals-row", width: w, align: "center", padding: { top: 6.4, bottom: 4.8, start: 6.4, end: 6.4 } });
  const up = upperProgress(me.scores) as number;
  para(b.bonus ? T("Lodge bonus earned (+{n})", { n: UPPER_BONUS }) : T("Upper bonus: {n}/{target}", { n: up, target: UPPER_BONUS_THRESHOLD }), w, "bonus-meter", "bonus-meter");
  (act as (() => void) | null)?.();
}
function tableRail(st: State, w: number): void {
  ui.column("rail-table", () => {
    ui.style("rail-h").id("rail-table-h").label(T("Table"));
    st.players.forEach((pl, i) => {
      const b = totalsBreakdown(pl.scores) as { grand: number };
      const cur = i === st.current;
      ui.row(`pl-${i}`, () => {
        if (cur) ui.style("cell-me").label("▶");
        ui.style("cell").label(ellipsize(playerName(pl.name) + (pl.isAI ? " 🤖" : ""), w - 80, "cell"));
        ui.spacer();
        ui.style("cell").id(`pl-score-${i}`).label(String(b.grand));
      }, { style: cur ? "player-row-current" : "player-row", width: w, align: "center", spacing: 6 });
    });
  }, { width: w, spacing: 5.6 });
  ui.column("rail-actions", () => {
    ui.style("rail-h").id("rail-actions-h").label(T("Actions"));
    for (const b of actionButtons(st, false)) button(b, w);
  }, { width: w, spacing: 8, padding: { top: 16 } });
}
function actionButtons(st: State, tray: boolean): Btn[] {
  const legal = listLegalActions(st) as { canRoll: boolean };
  const humanTurn = session.isHumanTurn();
  const canRoll = humanTurn && legal.canRoll && !app.countdown;
  const extra = tray ? ["btn-tray"] : [];
  const prefix = tray ? "tray" : "rail";
  return [
    { id: `${prefix}-roll`, text: `🎲 ${T("Roll ({n})", { n: st.rollsLeft })}`, label: canRoll ? T("Roll dice ({n} left)", { n: st.rollsLeft }) : T("Roll dice (unavailable)"), style: ["btn-primary", ...extra], disabled: !canRoll, act: tryRoll },
    { id: `${prefix}-hint`, text: T("Hint"), style: ["btn", ...extra], disabled: !humanTurn || !session.def?.assists?.hints, act: tryHint },
    { id: `${prefix}-undo`, text: T("Undo turn"), style: ["btn", ...extra], disabled: !session.undoAllowed(), act: tryUndo },
    { id: `${prefix}-pause`, text: T("Pause"), style: ["btn", ...extra], act: togglePause },
    { id: `${prefix}-leave`, text: T("Leave table"), style: ["btn-danger", ...extra], act: leaveTable },
  ];
}

// ------------------------------------------------------------------ the stage
interface Rect { x: number; y: number; w: number; h: number }
function stageHud(L: Layout, stage: Rect, st: State): void {
  const narrow = !L.wide;
  const landscape = narrow && !L.portrait;
  // Lesson banner (top of the stage; below the drawer buttons on narrow windows).
  const step = session.currentLessonStep();
  const bannerText = step ? T(step.text) : session.machine === "tutorial" ? T("Lesson complete — finish the table!") : "";
  if (bannerText) {
    const bw = Math.min(stage.w * 0.92, 544);
    ui.place("lesson-banner", { anchor: "top-start", x: stage.x + (stage.w - bw) / 2, y: stage.y + (narrow ? 64 : 11.2) }, () => {
      ui.style("lesson-banner", { text: { align: "center" } }).id("lesson-banner").paragraph(bannerText, bw - 32);
    }, { width: bw });
  }
  // Trays.
  const trayBtns = actionButtons(st, narrow && L.portrait).filter((b) => !(narrow && L.portrait) || !/-(pause|leave)$/.test(b.id));
  const trayW = Math.min(stage.w - 16, 720);
  let dieSize = 52;
  if (landscape) {
    const room = stage.h - 57.6 - 67.2;
    dieSize = Math.max(32, Math.min(56, room / 5 - 3.2 - 18));
    // Dice column at the right; tray at the bottom left.
    ui.place("dice-tray", { anchor: "top-start", x: stage.x + stage.w - 9.6 - dieSize - 8, y: stage.y + 57.6 }, () => {
      ui.column("dice-col", () => { for (let i = 0; i < 5; i++) die(i, st, dieSize); }, { spacing: Math.max(3.2, (room - (dieSize + 18) * 5) / 4), width: dieSize + 16, align: "center" });
    });
    const tw = Math.min(stage.w - dieSize - 48, 640);
    const r = ui.place("action-tray", { anchor: "top-start", x: stage.x + 9.6, y: stage.y + stage.h - (lastHeight.get("action-tray") ?? 52) - 8 }, () => flow("action-tray-flow", trayBtns, tw, "start"));
    lastHeight.set("action-tray", r.height / L.sc);
  } else {
    const ah = lastHeight.get("action-tray") ?? 52;
    const trayBottom = narrow ? 14.4 : 73.6;
    const r = ui.place("action-tray", { anchor: "top-start", x: stage.x + (stage.w - trayW) / 2, y: stage.y + stage.h - trayBottom - ah }, () => flow("action-tray-flow", trayBtns, trayW, "center"));
    lastHeight.set("action-tray", r.height / L.sc);
    const diceW = 5 * dieSize + 4 * 8;
    const diceBottom = narrow ? Math.max(131.2, 14.4 + ah + 30) : 12.8;
    ui.place("dice-tray", { anchor: "top-start", x: stage.x + (stage.w - diceW) / 2, y: stage.y + stage.h - diceBottom - dieSize - 18 }, () => {
      ui.row("dice-row", () => { for (let i = 0; i < 5; i++) die(i, st, dieSize); }, { spacing: 8, align: "end", height: dieSize + 18 });
    });
  }
  // Drawers (narrow windows): the rails behind the Card / Table buttons.
  if (narrow) {
    const dw = Math.min(L.lw * 0.85, 320);
    if (app.drawer === "left") rail("left", L, stage.x, stage.y, dw, stage.h, st, true);
    if (app.drawer === "right") rail("right", L, stage.x + stage.w - dw, stage.y, dw, stage.h, st, true);
    const swap = options.leftHanded;
    const cardW = buttonWidth(T("Card"), ["drawer-toggle"]), tableW = buttonWidth(T("Table"), ["drawer-toggle"]);
    const cx = swap ? stage.x + stage.w - 9.6 - cardW : stage.x + 9.6;
    const tx = swap ? stage.x + 9.6 : stage.x + stage.w - 9.6 - tableW;
    ui.place("drawer-left-toggle", { anchor: "top-start", x: cx, y: stage.y + 9.6 }, () => {
      if (ui.style("drawer-toggle").id("drawer-left-toggle").button(T("Card"))) app.drawer = app.drawer === "left" ? null : "left";
    });
    ui.place("drawer-right-toggle", { anchor: "top-start", x: tx, y: stage.y + 9.6 }, () => {
      if (ui.style("drawer-toggle").id("drawer-right-toggle").button(T("Table"))) app.drawer = app.drawer === "right" ? null : "right";
    });
  }
  if (app.countdown != null) {
    const size = Math.max(48, Math.min(L.lw * 0.12, 96));
    ui.place("countdown", { anchor: "top-start", x: stage.x + stage.w / 2 - size * 0.4, y: stage.y + stage.h / 2 - size * 0.7 }, () => ui.style("countdown", { text: { size } }).id("countdown").label(String(app.countdown)));
  }
}
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};
/** One die button of the tray (ui.js renderDiceTray): its face, raised and labelled HELD while held. */
function die(i: number, st: State, size: number): void {
  const v = st.dice[i]!;
  const held = !!st.held[i];
  const legal = listLegalActions(st) as { holdable: number[] };
  const canHold = session.isHumanTurn() && legal.holdable.length > 0 && !app.countdown;
  const t = theme();
  const label = v === 0 ? T("Die {n}, not rolled", { n: i + 1 })
    : `${T(held ? "Die {n}, showing {v}, held." : "Die {n}, showing {v}.", { n: i + 1, v })} ${canHold ? (held ? T("Activate to release") : T("Activate to hold")) : ""}`.trim();
  const res = ui.id(`die-${i}`).widget(label, {
    role: "toggle", checked: held, size: { width: size, height: size + 18 }, disabled: !canHold || v === 0,
    draw: (q, s) => {
      const k = s.scale;
      const lift = held && !s.reducedMotion ? -8 * k : 0;
      const x = q.x, y = q.y + 8 * k + lift, w = q.width, h = size * k;
      const alpha = s.disabled && !held ? 0.55 : 1;
      const face = alpha < 1 ? "#f4ead88c" : "#f4ead8";
      draw.box(x, y, w, h, { background: face, radius: 8.8, border: { width: held ? (s.highContrast ? 3.5 : 2) : 2, color: held ? t.select : "#ffffff1f" } });
      const ink = alpha < 1 ? "#33241a8c" : "#33241a";
      if (v === 0) { draw.text("–", x + w / 2, y + h / 2 - 12 * k, { size: 24 * k, color: ink, align: "center", weight: "700" }); }
      else {
        // The ⚀–⚅ glyph: an outlined square with the pips.
        const g = h * 0.46, gx = x + w / 2 - g / 2, gy = y + h / 2 - g / 2;
        draw.box(gx, gy, g, g, { radius: (g * 0.12) / k, border: { width: 1.6, color: ink } }); // box lengths are logical px
        for (const [px, py] of PIPS[v]!) draw.circle(gx + g / 2 + px * g * 0.27, gy + g / 2 + py * g * 0.27, g * 0.085, ink);
      }
      if (held) {
        const fs = 10 * k;
        draw.text(T("HELD"), x + w / 2, q.y + q.height - fs * 1.15, { size: fs, color: t.select, align: "center", weight: "700", letterSpacing: 0.8 * k });
      }
    },
  });
  if (res.focused) app.focusDie = i;
  if (res.activated && canHold && v > 0) tryHold(i);
}

// ------------------------------------------------------------------ the title
function titlePage(L: Layout): void {
  const f = frame();
  // Lodge key art behind the title card (a dim backdrop while it loads).
  ui.place("title-bg", { anchor: "top-start", x: -L.ox, y: -L.oy }, () => ui.widget("", {
    role: "none", size: { width: f.width / L.sc, height: f.height / L.sc },
    draw: (r) => {
      draw.box(r.x, r.y, r.width, r.height, {
        background: [
          { type: "linear", angle: 180, stops: [{ color: "#08050359", at: 0 }, { color: "#080503b3", at: 1 }] },
          { image: "assets/key-art.webp", size: "cover" }, "#140e0a",
        ],
      });
    },
  }));
  if (topModal() !== "title") return;
  const p = platform.progress();
  const hasSave = session.hasSnapshot();
  const daily = dailyDef();
  const doneToday = !!p.bestDaily[daily.id];
  const journeyDone = Object.values(p.journey).filter((j) => j.done).length;
  const w = Math.min(L.lw * 0.94, 640) - 41.6;
  const items: { id: string; label: string; sub: string; primary?: boolean; act: () => void }[] = [];
  if (hasSave) items.push({ id: "m-resume", label: T("Resume Table"), sub: T("continue your saved round"), primary: true, act: resumeSaved });
  items.push({ id: "m-practice", label: T("Practice"), sub: T("quick table vs the lodge AI"), primary: !hasSave, act: () => openModal("practice") });
  items.push({ id: "m-daily", label: T("Daily Table"), sub: doneToday ? T("{day} — played, best {best}", { day: daily.day!, best: p.bestDaily[daily.id]! }) : T("{day} — shared seed", { day: daily.day! }), act: () => startContent(dailyDef()) });
  items.push({ id: "m-journey", label: T("Journey"), sub: T("{n} / {total} stages cleared", { n: journeyDone, total: JOURNEY.length }), act: () => openModal("journey") });
  items.push({ id: "m-learn", label: T("Learn"), sub: T("interactive lessons, one rule at a time"), act: () => openModal("learn") });
  items.push({ id: "m-challenges", label: T("Challenges"), sub: T("constrained tables for sharp players"), act: () => openModal("challenges") });
  items.push({ id: "m-profile", label: T("Profile & Scores"), sub: T("achievements, leaderboards, stats"), act: () => { loadBoard(app.board?.key ?? "daily", app.board?.label ?? N("Daily tables")); openModal("profile"); } });
  if (!platform.signedIn()) items.push({ id: "m-signin", label: T("Sign in with StarHermit"), sub: T("sync progress and settings to your account"), act: signIn });
  if (platform.inviteLink()) items.push({ id: "m-invite", label: T("Invite a friend"), sub: T("copy a link that adds you as friends"), act: copyInvite });
  items.push({ id: "m-help", label: T("Help & Rules"), sub: T("how a table works"), act: () => openModal("help") });
  items.push({ id: "m-settings", label: T("Settings"), sub: T("audio, display, language, graphics, controls"), act: () => openModal("settings") });
  const h = lastHeight.get("title") ?? 0;
  const avail = L.lh - 32;
  const body = (): void => {
    const r = ui.column("title-body", () => {
      para(T("A cozy mountain-lodge dice table. Roll five dice up to three times, hold the keepers, and fill your card — highest total wins."), w, "body", "tagline");
      ui.column("menu", () => { for (const it of items) menuButton(it.id, it.label, it.sub, w, it.primary, it.act); }, { width: w, spacing: 8.8, padding: { top: 6.4 } });
      para(T("Content v{v} · Rules v1 · seed-fair: every table is replayable and inspectable.", { v: CONTENT_VERSION }), w, "muted", "content-line");
    }, { width: w, spacing: 8 });
    lastHeight.set("title", r.height / L.sc + 35.2);
  };
  const fresh = frame().frame - app.modalOpened <= 4;
  // The title card is modal over the shell: a dialog without a dim of its own (the key art is the backdrop).
  ui.style("title-card").dialog("Five Dice", "", true, () => {
    if (h > avail) ui.scrollArea("title-scroll", { width: w + 14, height: avail - 35.2 }, body, fresh ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
  const age = frame().frame - app.modalOpened;
  if (age >= 1 && age <= 3) ui.setFocus(items[0]!.id);
}
/** A menu-list button: the label at the start, its note at the end (under it when narrow). */
function menuButton(id: string, label: string, sub: string, w: number, primary: boolean | undefined, act: () => void, disabled = false): void {
  const inner = w - 35.2 - 2;
  const lw = textWidth(label, "strong"), sw = textWidth(sub, "sub");
  const one = lw + sw + 24 <= inner;
  const subCls = primary ? ["sub", "on-accent"] : ["sub"];
  const opts: ui.ButtonOptions = {
    content: () => {
      if (one) ui.row(`${id}-c`, () => { ui.style("strong", primary ? { text: { color: "$on-accent" } } : {}).label(label); ui.spacer(); ui.style(...subCls.filter((c) => c === "sub"), primary ? { text: { color: "$on-accent" } } : {}).label(sub); }, { width: inner, align: "center" });
      else ui.column(`${id}-c`, () => { para(label, inner, "strong"); if (sub) ui.style("sub", primary ? { text: { color: "$on-accent" } } : {}).paragraph(sub, inner); }, { width: inner, spacing: 2 });
    },
  };
  if (disabled) opts.disabled = true;
  if (ui.style(primary ? "menu-btn-primary" : "menu-btn", { width: w }).id(id).button(label, opts)) act();
}

// ------------------------------------------------------------------ dialogs
/** A modal card: a scrolling body when taller than the window, a pinned footer (its buttons stay clickable). */
function dialogFrame(id: string, title: string, L: Layout, build: (w: number) => void, footer: ((w: number) => void) | null, onClose: (() => void) | null, focus: string | null = null, heading = true): void {
  const w = Math.min(640, L.lw * 0.94) - 41.6 - 2;
  const fh = footer ? (lastHeight.get(`dlg-${id}-foot`) ?? 56) + 12 : 0;
  const avail = Math.max(80, L.lh * 0.88 - 35.2 - fh);
  const h = lastHeight.get(`dlg-${id}`) ?? 0;
  const body = (): void => {
    const r = ui.column(`${id}-body`, () => {
      if (heading) ui.row(`${id}-title`, () => {
        const tw = w - (onClose ? 56 : 0);
        if (textWidth(title, "h2", "heading") <= tw) ui.style("h2").id(`${id}-h`).heading(title);
        else ui.style("h2").paragraph(title, tw);
        if (onClose) {
          ui.spacer();
          if (ui.style("btn").id(`${id}-close`).button(T("Close"), { content: () => ui.label("✕") })) onClose();
        }
      }, { width: w, spacing: 8, align: "center" });
      build(w);
    }, { spacing: 8, width: w });
    lastHeight.set(`dlg-${id}`, r.height / L.sc);
  };
  const fresh = frame().frame - app.modalOpened <= 4;
  const open = ui.dialog(title, "", true, () => {
    if (h > avail) ui.scrollArea(`${id}-scroll`, { width: w + 14, height: avail }, body, fresh ? { scrollTo: { top: 0 } } : undefined);
    else body();
    if (footer) {
      const r = ui.column(`${id}-foot`, () => footer(w), { width: w, spacing: 8.8, padding: { top: 12 } });
      lastHeight.set(`dlg-${id}-foot`, r.height / L.sc - 12);
    }
  });
  const age = frame().frame - app.modalOpened;
  if (focus && age >= 1 && age <= 3) ui.setFocus(focus);
  // The Escape (or East) that opened it must not close it the same frame.
  if (!open && frame().frame !== app.modalOpened && onClose) onClose();
}
function dialogs(L: Layout): void {
  const m: Modal | null = topModal();
  switch (m) {
    case "practice": return practiceDialog(L);
    case "learn": return learnDialog(L);
    case "journey": return journeyDialog(L);
    case "challenges": return challengesDialog(L);
    case "help": return helpDialog(L);
    case "settings": return settingsDialog(L);
    case "profile": return profileDialog(L);
    case "pause": return pauseDialog(L);
    case "results": return resultsDialog(L);
    case "confirm": return confirmDialog(L);
    default:
  }
}
function listDialog(id: string, title: string, L: Layout, build: (w: number) => void, focus: string): void {
  dialogFrame(id, title, L, build, null, closeModal, focus);
}
function practiceDialog(L: Layout): void {
  listDialog("practice", T("Practice setup"), L, (w) => {
    para(T("Unranked. Undo and hints are on; restart freely."), w, "muted");
    ui.column("practice-list", () => {
      Object.values(PRACTICE_DIFFICULTIES as Record<string, { id: string; name: string; blurb: string }>).forEach((d, i) => {
        menuButton(`practice-${i}`, T(d.name), T(d.blurb), w, false, () => startContent(practice({ difficulty: d.id })));
      });
      menuButton("practice-2p", T("Two players, one screen"), T("pass-and-play, no AI"), w, false, () => startContent(practice({ difficulty: "hearth", humans: 2, aiOpponents: 0 })));
    }, { width: w, spacing: 8.8 });
  }, "practice-0");
}
function learnDialog(L: Layout): void {
  listDialog("learn", T("Learn"), L, (w) => {
    ui.column("learn-list", () => {
      (LESSONS as Def[]).forEach((l, i) => {
        const done = options.tutorialsDone[l.id];
        menuButton(`lesson-${i}`, `${i + 1}. ${T(l.name)}${done ? " ✓" : ""}`, "", w, false, () => startContent(l));
      });
    }, { width: w, spacing: 8.8 });
  }, "lesson-0");
}
function journeyDialog(L: Layout): void {
  const progress = platform.progress().journey;
  let unlocked = 0;
  while (unlocked < JOURNEY.length && progress[(JOURNEY[unlocked] as Def).id]?.done) unlocked++;
  listDialog("journey", T("Journey"), L, (w) => {
    const gap = 9.6;
    const cols = Math.max(1, Math.floor((w + gap) / (150 + gap)));
    const cw = (w - gap * (cols - 1)) / cols;
    (TRAILS as { name: string }[]).forEach((trail, t) => {
      ui.column(`trail-${t}-h`, () => ui.style("h3").label(T(trail.name)), { padding: { top: 6.4 } });
      ui.column(`trail-${t}`, () => {
        for (let r = 0; r < 8; r += cols) {
          ui.row(`trail-${t}-r${r}`, () => {
            for (let s = r; s < Math.min(8, r + cols); s++) {
              const idx = t * 8 + s;
              const stage = JOURNEY[idx] as Def & { goal?: { type: string; target?: number } };
              const rec = progress[stage.id];
              const locked = idx > unlocked;
              const name = defTitle(stage);
              const inner = cw - 24.4;
              if (ui.style(stage.mastery ? "stage-card-mastery" : "stage-card", { width: cw }).id(`stage-${idx}`).button(locked ? T("{name} (locked)", { name }) : name, {
                disabled: locked,
                content: () => ui.column(`stage-${idx}-c`, () => {
                  ui.style("body").label(`${stage.stage}. ${stage.mastery ? T("Mastery") : ""}`);
                  ui.style("stars").label(rec?.done ? "★".repeat(rec.stars || 1) : locked ? "🔒" : "—");
                  para(stage.goal?.type === "score" ? T("Target {n}", { n: stage.goal.target! }) : T("{n}-handed", { n: stage.players.length }), inner, "muted");
                }, { width: inner, spacing: 2, align: "start" }),
              })) startContent(stage);
            }
          }, { spacing: gap, align: "stretch" });
        }
      }, { width: w, spacing: gap });
    });
  }, `stage-${Math.min(unlocked, JOURNEY.length - 1)}`);
}
function challengesDialog(L: Layout): void {
  listDialog("challenges", T("Challenges"), L, (w) => {
    ui.column("ch-list", () => {
      (CHALLENGES as Def[]).forEach((ch, i) => {
        const rec = platform.progress().challenges[ch.id];
        menuButton(`challenge-${i}`, `${T(ch.name)}${rec?.done ? " ✓" : ""}`, T(ch.blurb ?? ""), w, false, () => startContent(ch));
      });
    }, { width: w, spacing: 8.8 });
  }, "challenge-0");
}
function helpDialog(L: Layout): void {
  listDialog("help", T("Help & Rules"), L, (w) => {
    ui.style("h3").label(T("How a table works"));
    para(T("Roll five dice. You may reroll any unheld dice twice more (three rolls total). Tap a die to hold it between rolls. Then choose exactly one open category on the card to score. When every category on every card is filled, the highest grand total wins."), w);
    ui.style("h3").label(T("The card"));
    ui.column("help-cats", () => {
      for (const cat of CATEGORIES as { id: string; name: string; desc: string }[]) para(`• ${T(cat.name)} — ${T(cat.desc)}`, w);
    }, { width: w, spacing: 2 });
    para(T("Upper rows ({first}…{last}) totaling {n}+ earn a {bonus}-point lodge bonus.", { first: T("Kindling"), last: T("Peaks"), n: UPPER_BONUS_THRESHOLD, bonus: UPPER_BONUS }), w);
    ui.style("h3").label(T("Controls"));
    para(T("Roll: {roll} or the Roll button. Hold die: {hold} or tap. Hint: {hint}. Undo: {undo} where allowed. Pause: {pause}. Camera: {camera}. {prev}/{next} move focus; {confirm} confirms. Gamepad: D-pad moves focus, A holds, X rolls, Start pauses.", {
      roll: keyName("roll"), hold: [0, 1, 2, 3, 4].map((i) => keyName(`hold${i}`)).join(", "), hint: keyName("hint"), undo: keyName("undo"),
      pause: keyName("pause"), camera: keyName("camera"), prev: keyName("focus_prev"), next: keyName("focus_next"), confirm: keyName("confirm"),
    }), w);
    para(T("Every table is seeded and replayable; the same seed and choices always produce the same dice."), w, "muted");
  }, "help-close");
}
function settingsDialog(L: Layout): void {
  listDialog("settings", T("Settings"), L, (w) => {
    const row = (id: string, label: string, control: (cw: number) => void): void => {
      ui.row(`${id}-row`, () => {
        para(label, Math.max(80, w * 0.45), "body");
        ui.spacer();
        control(Math.min(240, w * 0.5));
      }, { width: w, align: "center", spacing: 12, height: 48 });
    };
    const select = (id: string, label: string, cur: number, items: string[], set: (i: number) => void): void => {
      row(id, label, (cw) => { const next = ui.style({ width: cw }).id(id).select(label, cur, items); if (next !== cur) set(next); });
    };
    const toggle = (key: "captions" | "leftHanded" | "holdToConfirm" | "timingAssist" | "haptics", label: string): void => {
      const cur = options[key];
      const next = ui.id(`set-${key}`).checkbox(label, cur);
      if (next !== cur) platform.setOption(key, next);
    };
    ui.style("h3").label(T("Audio"));
    para(T("Volumes, mute, graphics quality, frame rate, language, reduced motion, high contrast and text size are in the StarHermit Options."), w, "muted");
    flow("set-runtime", [{ id: "btn-options", text: T("Open Options"), act: () => openMenu() }], w, "start");
    toggle("captions", T("Captions for audio cues"));
    ui.style("h3").label(T("Display"));
    const ti = Math.max(0, (THEMES as { id: string }[]).findIndex((x) => x.id === options.theme));
    select("set-theme", T("Theme"), ti, (THEMES as { name: string }[]).map((x) => T(x.name)), (i) => platform.setOption("theme", (THEMES[i] as { id: string }).id));
    const CAM: [string, string][] = [["standard", N("Standard")], ["low", N("Low")], ["overhead", N("Overhead")]];
    const ci = Math.max(0, CAM.findIndex(([v]) => v === options.cameraTilt));
    select("set-camera", T("Camera"), ci, CAM.map(([, n]) => T(n)), (i) => platform.setOption("cameraTilt", CAM[i]![0]));
    const PAL: [string, string][] = [["default", N("Default")], ["deuteranopia", N("Deuteranopia-safe")], ["protanopia", N("Protanopia-safe")], ["tritanopia", N("Tritanopia-safe")]];
    const pi = Math.max(0, PAL.findIndex(([v]) => v === options.palette));
    select("set-palette", T("Color-vision palette"), pi, PAL.map(([, n]) => T(n)), (i) => platform.setOption("palette", PAL[i]![0]));
    ui.style("h3").label(T("Controls & access"));
    toggle("leftHanded", T("Left-handed controls"));
    toggle("holdToConfirm", T("Hold to confirm scoring"));
    toggle("timingAssist", T("Timing assistance"));
    toggle("haptics", T("Haptics"));
    flow("set-buttons", [
      { id: "btn-rebind", text: T("Change keys and buttons"), act: () => requestRebind() },
      { id: "btn-tutorials", text: T("Replay tutorials"), act: () => { platform.setOption("tutorialsDone", {}); toast(T("Tutorials reset")); } },
    ], w, "start");
  }, "btn-options");
}
function profileDialog(L: Layout): void {
  const p = platform.progress();
  listDialog("profile", T("Profile & Scores"), L, (w) => {
    if (platform.signedIn()) {
      ui.row("prof-player", () => { para(T("Player"), w * 0.4); ui.spacer(); ui.style("strong").label(platform.displayName() || "…"); }, { width: w, align: "center", height: 44 });
    } else {
      ui.row("prof-name", () => {
        para(T("Display name"), w * 0.4);
        ui.spacer();
        const cur = app.guestName === "Guest" ? playerName("Guest") : app.guestName;
        const next = ui.style("name-field").textField("name-field", cur, { maxChars: 20, width: Math.min(240, w * 0.55) });
        if (next !== cur) setGuestName(next);
      }, { width: w, align: "center", spacing: 12 });
    }
    para(platform.signedIn() ? T("Signed in with your account.") : T("Guest profile — progress is stored on this device. Sign in from the host shell for durable cloud progress."), w, "muted");
    para(syncLabel(), w, "muted");
    ui.style("h3").label(T("Lifetime"));
    const t = p.totals;
    para(T("{games} tables · {wins} wins · {points} total points · {avalanches} avalanches · {days} active days", { games: t.games, wins: t.wins, points: t.points, avalanches: t.avalanches, days: p.streakDays.length }), w);
    ui.style("h3").label(T("Achievements"));
    ui.column("ach-list", () => {
      for (const a of ACHIEVEMENTS as { key: string; name: string; desc: string }[]) {
        const got = !!p.achievements[a.key];
        ui.column(`ach-${a.key}`, () => { para(`${got ? "🏆" : "○"} ${T(a.name)}`, w - 22, "ach-name"); para(T(a.desc), w - 22, "muted"); }, { style: got ? "ach" : "ach-locked", width: w, spacing: 2 });
      }
    }, { width: w, spacing: 6.4 });
    ui.style("h3").label(T("Leaderboards"));
    flow("board-tabs", [
      { id: "tab-daily", text: T("Daily"), act: () => loadBoard("daily", N("Daily tables")) },
      { id: "tab-challenge", text: T("Challenge"), act: () => loadBoard("challenge", N("Challenge tables")) },
      { id: "tab-journey", text: T("Journey wins"), act: () => loadBoard("journey", N("Journey wins")) },
    ], w, "start");
    const b = app.board;
    if (!b || !b.entries) { para(T("Loading…"), w, "muted"); return; }
    para(`${T(b.label)} · ${T(b.source)}`, w, "muted", "board-label");
    const cw = [36, w - 36 - 90, 90];
    ui.row("lb-head", () => { cell("lb-h0", "#", cw[0]!, "th"); cell("lb-h1", T("Player"), cw[1]!, "th"); cell("lb-h2", T("Score"), cw[2]!, "th", true); }, { style: "table-row", width: w, spacing: 0, padding: { top: 4.8, bottom: 4.8 } });
    if (!b.entries.length) para(T("No entries yet — play a table!"), w);
    b.entries.slice(0, 10).forEach((e, i) => {
      const cls = e.me ? "cell-me" : "cell";
      ui.row(`lb-${i}`, () => { cell(`lb-${i}-0`, String(i + 1), cw[0]!, cls); cell(`lb-${i}-1`, playerName(e.name), cw[1]!, cls); cell(`lb-${i}-2`, String(e.score), cw[2]!, cls, true); }, { style: "table-row", width: w, spacing: 0, padding: { top: 4.8, bottom: 4.8 } });
    });
  }, "profile-close");
}
function pauseDialog(L: Layout): void {
  dialogFrame("pause", T("Paused"), L, (w) => {
    ui.column("pause-list", () => {
      menuButton("btn-resume-table", T("Resume"), "", w, true, resumeTable);
      menuButton("btn-pause-settings", T("Settings"), "", w, false, () => openModal("settings"));
      menuButton("btn-pause-help", T("Help"), "", w, false, () => openModal("help"));
      menuButton("btn-pause-leave", T("Leave table"), "", w, false, () => app.confirm == null && confirmForfeit());
    }, { width: w, spacing: 8.8 });
  }, null, resumeTable, "btn-resume-table");
}
function confirmForfeit(): void {
  app.confirm = { text: () => T("Forfeit this table?"), yes: () => { session.giveUp(); } };
  openModal("confirm");
}
function confirmDialog(L: Layout): void {
  const c = app.confirm;
  if (!c) { closeModal(); return; }
  dialogFrame("confirm", T("Confirm"), L, (w) => {
    para(c.text(), w);
    ui.row("confirm-row", () => {
      button({ id: "btn-yes", text: T("Yes"), style: ["btn-danger"], act: () => { closeModal(); c.yes(); } });
      button({ id: "btn-cancel", text: T("Cancel"), act: closeModal });
    }, { spacing: 8 });
  }, null, closeModal, "btn-yes");
}
function resultsDialog(L: Layout): void {
  const x = app.results;
  if (!x) { showTitle(); return; }
  const { record, won, newly } = x;
  const b = record.score;
  const headline = won ? "🏔 " + T("You take the table!") : record.reason === "gave-up" ? T("Table forfeited") : record.reason === "time-limit" ? "⏱ " + T("The blizzard wins") : T("The lodge keeps its crown");
  dialogFrame("results", T("Results"), L, (w) => {
    if (!L.short) art("results-art", won ? "assets/results-win.webp" : "assets/results-lose.webp", w, Math.min(w * 0.3, 176, L.lh * 0.22), 9.6);
    para(headline, w, "h2", "results-h");
    const secs = (record.durationMs / 1000).toFixed(0);
    para(T(record.invalid === 1
      ? "Your card: upper {upper} + bonus {bonus} + lower {lower} = {grand} points · {invalid} invalid action · {secs}s"
      : "Your card: upper {upper} + bonus {bonus} + lower {lower} = {grand} points · {invalid} invalid actions · {secs}s",
    { upper: b.upper, bonus: b.bonus, lower: b.lower, grand: b.grand, invalid: record.invalid, secs }), w, "body", "results-line");
    const par = session.def?.par?.score;
    if (par) para(T("Par for this table: {n}", { n: par }), w, "muted");
    const num = Math.max(44, Math.min(76, (w - 30) / 7));
    const cw = [30, w - 30 - num * 4, num, num, num, num];
    const narrow = w < 420;
    const cls = (me: boolean): string => (me ? "cell-me" : "cell");
    ui.column("rank-table", () => {
      ui.row("rank-head", () => {
        cell("rh0", "#", cw[0]!, "th"); cell("rh1", T("Player"), cw[1]!, "th");
        [T("Upper"), T("Bonus"), T("Lower"), T("Total")].forEach((h, i) => cell(`rh${i + 2}`, h, cw[i + 2]!, "th", true));
      }, { style: "table-row", width: w, spacing: 0, padding: { top: narrow ? 4 : 4.8, bottom: narrow ? 4 : 4.8 } });
      record.rankings.forEach((r, i) => {
        ui.row(`rank-${i}`, () => {
          cell(`r${i}-0`, String(i + 1), cw[0]!, cls(r.player === 0)); cell(`r${i}-1`, playerName(r.name), cw[1]!, cls(r.player === 0));
          [r.upper, r.bonus, r.lower, r.grand].forEach((v, j) => cell(`r${i}-${j + 2}`, String(v ?? ""), cw[j + 2]!, cls(r.player === 0), true));
        }, { style: "table-row", width: w, spacing: 0, padding: { top: narrow ? 4 : 4.8, bottom: narrow ? 4 : 4.8 } });
      });
    }, { width: w, spacing: 0 });
    const lb = leaderboardLine();
    if (lb) para(lb, w, "muted", "results-lb");
    if (newly.length) {
      ui.style("h3").label(T("Achievements unlocked"));
      for (const key of newly) {
        const a = ACHIEVEMENTS.find((q: { key: string }) => q.key === key) as { name: string; desc: string } | undefined;
        if (a) ui.column(`new-${key}`, () => { para(`🏆 ${T(a.name)}`, w - 22, "ach-name"); para(T(a.desc), w - 22, "muted"); }, { style: "ach", width: w, spacing: 2 });
      }
    }
  }, (w) => {
    const next = nextStage();
    const list: { id: string; text: string; primary: boolean; act: () => void }[] = [];
    if (next) list.push({ id: "btn-next", text: T("Next: {name}", { name: defTitle(next) }), primary: true, act: () => startContent(next) });
    list.push({ id: "btn-again", text: T("Play again"), primary: !next, act: playAgain });
    list.push({ id: "btn-title", text: T("Back to title"), primary: false, act: showTitle });
    for (const b2 of list) menuButton(b2.id, b2.text, "", w, b2.primary, b2.act);
  }, null, next0(), false);
}
const next0 = (): string => (nextStage() ? "btn-next" : "btn-again");

// ------------------------------------------------------------------ toasts and captions
function toastAndCaption(L: Layout, stage: Rect): void {
  const tt = app.toast;
  if (tt) {
    const w = Math.min(L.lw * 0.9, 560);
    ui.place("toast", { anchor: "bottom", y: 112 }, () => {
      if (textWidth(tt.text, "toast") + 34 <= w) ui.style("toast").id("toast").label(tt.text);
      else ui.style("toast").id("toast").paragraph(tt.text, w - 34);
    });
  }
  const c = app.caption;
  if (c) {
    ui.place("caption", { anchor: "top-start", x: stage.x + 9.6, y: stage.y + stage.h - 40 }, () => ui.row("caption-row", () => {
      ui.style("caption").id("caption").label(`♪ ${c.text}`);
    }, { style: "caption-box", align: "center" }));
  }
}
