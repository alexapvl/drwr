import QRCode from "qrcode";
import { Sheet, type SheetOptions } from "../src/index.js";
import "../src/styles.css";

// --- Event log ---------------------------------------------------------------

const logEl = document.getElementById("log")!;
let lastTap = performance.now();

document.addEventListener("pointerdown", () => (lastTap = performance.now()), true);

function log(message: string) {
  const ms = Math.round(performance.now() - lastTap);
  const line = document.createElement("div");
  line.innerHTML = `<span class="t">+${ms}ms</span> ${message}`;
  logEl.prepend(line);
  while (logEl.childElementCount > 200) logEl.lastElementChild?.remove();
}

document.getElementById("log-toggle")!.addEventListener("click", () => {
  logEl.toggleAttribute("data-expanded");
});

window.addEventListener("pageshow", (e) => {
  if (e.persisted) log("pageshow: restored from back/forward cache");
});

// --- Helpers -----------------------------------------------------------------

const rows = (n: number, label = "Item", tappable = false) =>
  Array.from({ length: n }, (_, i) =>
    tappable
      ? `<div class="row" data-tap="${label} ${i}">${label} ${i} <small>(tap me)</small></div>`
      : `<div class="row">${label} ${i}</div>`,
  ).join("");

const TOP = 64; // keeps the log bar visible above a fully open sheet

/** A snap that hugs the sheet's content, like the drwr-web skill does. */
function hugSnap(host: HTMLElement): number {
  const content = host.querySelector<HTMLElement>(".drwr-content");
  const handle = host.querySelector<HTMLElement>(".drwr-handle");
  const h = (content?.scrollHeight ?? 0) + (handle?.offsetHeight ?? 0);
  return Math.min(1, Math.max(0.15, h / Math.max(1, window.innerHeight - TOP)));
}

// --- Scenarios ---------------------------------------------------------------

interface Ctx {
  sheet: Sheet;
  host: HTMLElement;
  open: (id: string) => void;
}

interface Scenario {
  id: string;
  title: string;
  desc: string;
  html: string;
  options?: SheetOptions;
  hostClass?: string;
  /** Snap to open at. Default: the highest. */
  openAt?: number | ((ctx: Ctx) => number);
  setup?: (ctx: Ctx) => void;
}

const scenarios: Scenario[] = [
  {
    id: "long",
    title: "Long list, 3 snaps",
    desc: "Expand-first, scroll, pull down at top",
    options: { snapPoints: [0, 0.5, 1] },
    openAt: 0.5,
    html: `<div class="sheet-pad"><h2>Long list</h2>
      <p class="hint">Opens at half. Swipe up on the list: the sheet grows first, then the list scrolls. Scroll down, then pull down at the top: the sheet moves. Tap rows: a drag must never count as a tap.</p></div>
      ${rows(60, "Row", true)}`,
  },
  {
    id: "nested",
    title: "Nested scroller + carousel",
    desc: "Inner list, sideways strip",
    options: { snapPoints: [0, 1] },
    html: `<div class="sheet-pad"><h2>Nested scrollers</h2>
      <p class="hint">The boxed list scrolls on its own. The strip scrolls sideways without moving the sheet. Drag the text around them to move the sheet.</p></div>
      <div class="carousel">${Array.from({ length: 10 }, (_, i) => `<div>card ${i}</div>`).join("")}</div>
      <div class="inner-scroll">${rows(30, "Inner")}</div>
      ${rows(6, "After")}`,
  },
  {
    id: "links",
    title: "Links and buttons",
    desc: "Tap latency, hash, external, old pattern",
    options: { snapPoints: [0, 1] },
    openAt: (ctx) => hugSnap(ctx.host),
    html: `<div class="sheet-pad"><h2>Links</h2>
      <p class="hint">Each logs its tap. "Old pattern" waits for onClose before navigating: compare how it feels.</p>
      <div class="btns">
        <button type="button" data-act="count">Button (counts taps)</button>
        <a href="#anchor-target" data-act="hash">Hash link</a>
        <a href="?from=sheet" data-act="nav">Same-site link</a>
        <a href="https://example.com" data-act="external">External link</a>
        <a href="https://example.com" target="_blank" rel="noopener" data-act="blank">New tab</a>
        <a href="?from=old-pattern" data-act="old">Old pattern (close, then go)</a>
      </div></div>`,
    setup({ sheet, host }) {
      let taps = 0;
      host.addEventListener("click", (e) => {
        const el = (e.target as Element).closest<HTMLElement>("[data-act]");
        if (!el) return;
        const act = el.dataset.act;
        log(`click: ${act}`);
        if (act === "count") {
          el.textContent = `Button (${++taps} taps)`;
        } else if (act === "hash") {
          e.preventDefault();
          sheet.close();
          document.getElementById("anchor-target")?.scrollIntoView({ behavior: "smooth" });
          history.pushState(null, "", "#anchor-target");
        } else if (act === "blank") {
          sheet.close();
        } else if (act === "old") {
          e.preventDefault();
          const href = (el as HTMLAnchorElement).href;
          sheet.setOptions({ onClose: () => location.assign(href) });
          sheet.close();
        }
        // "nav" and "external": the browser follows them right away.
      });
    },
  },
  {
    id: "form",
    title: "Form fields",
    desc: "Focus, keyboard, select",
    options: { snapPoints: [0, 1] },
    html: `<div class="sheet-pad"><h2>Form</h2>
      <p class="hint">Tap fields: the keyboard must not push the sheet off screen, and a drag from a field still moves the sheet.</p>
      <label>Name</label><input placeholder="Type here" />
      <label>Notes</label><textarea rows="4"></textarea>
      <label>Pick</label><select><option>One</option><option>Two</option><option>Three</option></select>
      <label>Range (should slide, not drag the sheet)</label><input type="range" />
      ${rows(8, "Below")}</div>`,
    setup({ host }) {
      host.addEventListener("focusin", (e) => log(`focus: ${(e.target as Element).tagName.toLowerCase()}`));
    },
  },
  {
    id: "handle",
    title: "Handle-only drag",
    desc: "dragMode: handle",
    options: { snapPoints: [0, 0.6, 1], dragMode: "handle" },
    openAt: 0.6,
    html: `<div class="sheet-pad"><h2>Handle only</h2>
      <p class="hint">Only the handle drags. The content scrolls freely, the slider slides.</p>
      <input type="range" /></div>${rows(40, "Row")}`,
  },
  {
    id: "short",
    title: "Short content (hug)",
    desc: "Snap sized to content",
    options: { snapPoints: [0, 1] },
    openAt: (ctx) => hugSnap(ctx.host),
    html: `<div class="sheet-pad"><h2>Short</h2><p class="hint">Hugs its content. Swiping up does nothing, swiping down closes.</p>
      <div class="btns"><button type="button">One</button><button type="button">Two</button></div></div>`,
  },
  {
    id: "dynamic",
    title: "Dynamic content",
    desc: "Grow and shrink, refresh()",
    options: { snapPoints: [0, 1] },
    openAt: (ctx) => hugSnap(ctx.host),
    html: `<div class="sheet-pad"><h2>Dynamic</h2>
      <p class="hint">Adds or removes rows, then refits the snap to the content.</p>
      <div class="btns"><button type="button" data-d="add">+5 rows</button><button type="button" data-d="remove">-5 rows</button></div></div>
      <div data-list>${rows(3, "Row")}</div>`,
    setup({ sheet, host }) {
      let count = 3;
      host.addEventListener("click", (e) => {
        const d = (e.target as HTMLElement).dataset.d;
        if (!d) return;
        count = Math.max(0, count + (d === "add" ? 5 : -5));
        host.querySelector("[data-list]")!.innerHTML = rows(count, "Row");
        sheet.refresh();
        const snap = hugSnap(host);
        sheet.setSnapPoints([0, snap]);
        sheet.snapTo(snap);
        log(`rows: ${count}, snap ${snap.toFixed(2)}`);
      });
    },
  },
  {
    id: "gated",
    title: "Gated overflow (old kairoskraft)",
    desc: "overflow hidden until onSnap top",
    hostClass: "gated",
    options: { snapPoints: [0, 0.6, 1] },
    openAt: 0.6,
    html: `<div class="sheet-pad"><h2>Gated overflow</h2>
      <p class="hint">The page hides overflow until onSnap reports the top snap: the pattern drwr no longer needs. Try scrolling right after the sheet reaches the top.</p></div>
      ${rows(50, "Row")}`,
    setup({ host }) {
      const content = host.querySelector(".drwr-content")!;
      // set by the shared onSnap logger below
      host.addEventListener("drwr-snap", ((e: CustomEvent<number>) => {
        content.toggleAttribute("data-top", e.detail >= 0.999);
        log(`data-top: ${content.hasAttribute("data-top")}`);
      }) as EventListener);
    },
  },
  {
    id: "handoff",
    title: "Sheet to sheet",
    desc: "One closes as the next opens",
    options: { snapPoints: [0, 1] },
    openAt: (ctx) => hugSnap(ctx.host),
    html: `<div class="sheet-pad"><h2>Sheet A</h2>
      <p class="hint">Opens sheet B while A closes. After both close, the page must scroll again.</p>
      <div class="btns"><button type="button" data-next>Open sheet B</button></div></div>`,
    setup({ sheet, host, open }) {
      host.querySelector("[data-next]")!.addEventListener("click", () => {
        sheet.close();
        open("short");
      });
    },
  },
  {
    id: "nonmodal",
    title: "No overlay, not modal",
    desc: "overlay: false, modal: false",
    options: { snapPoints: [0, 0.35, 1], overlay: false, modal: false, trapFocus: false },
    openAt: 0.35,
    html: `<div class="sheet-pad"><h2>Non-modal</h2><p class="hint">No overlay. Close by dragging down or with Escape.</p></div>${rows(30, "Row")}`,
  },
];

// --- Mounting ----------------------------------------------------------------

const live = new Map<string, { sheet: Sheet; host: HTMLElement }>();

function teardown(id: string) {
  const entry = live.get(id);
  if (!entry) return;
  live.delete(id);
  entry.sheet.destroy();
  entry.host.remove();
}

function open(id: string) {
  const scenario = scenarios.find((s) => s.id === id);
  if (!scenario) return;
  teardown(id);

  const host = document.createElement("div");
  host.hidden = true;
  host.className = scenario.hostClass ?? "";
  host.innerHTML = scenario.html;
  document.body.append(host);

  const sheet = new Sheet(host, {
    topPadding: TOP,
    ariaLabel: scenario.title,
    ...scenario.options,
    onOpen: () => log(`${id}: onOpen`),
    onSnap: (p) => {
      log(`${id}: onSnap ${p.toFixed(2)}`);
      host.dispatchEvent(new CustomEvent("drwr-snap", { detail: p }));
    },
    onCloseStart: () => log(`${id}: onCloseStart`),
    onClose: () => {
      log(`${id}: onClose (page overflow: "${document.documentElement.style.overflow}")`);
      // destroy after the callback returns, so the "old pattern" link still navigates
      setTimeout(() => {
        if (live.get(id)?.sheet === sheet) teardown(id);
      });
    },
  });
  live.set(id, { sheet, host });

  host.addEventListener("click", (e) => {
    const row = (e.target as Element).closest<HTMLElement>("[data-tap]");
    if (row) log(`tap: ${row.dataset.tap}`);
  });

  const ctx: Ctx = { sheet, host, open };
  scenario.setup?.(ctx);

  const at = typeof scenario.openAt === "function" ? scenario.openAt(ctx) : scenario.openAt;
  if (at !== undefined) {
    const snaps = scenario.options?.snapPoints ?? [0, 1];
    if (!snaps.includes(at)) sheet.setSnapPoints([...snaps.filter((s) => s < at), at]);
    sheet.open(at);
  } else {
    sheet.open();
  }
  log(`open: ${id}`);
}

const grid = document.getElementById("scenarios")!;
for (const s of scenarios) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "scenario";
  btn.innerHTML = `<b>${s.title}</b><span>${s.desc}</span>`;
  btn.addEventListener("click", () => open(s.id));
  grid.append(btn);
}

// --- Page filler, so page scroll lock is testable ------------------------------

const filler = (n: number, from: number) =>
  Array.from({ length: n }, (_, i) => `<p>Page paragraph ${from + i}. The page behind a sheet must not scroll while it's open, and must scroll again once it closes.</p>`).join("");
document.getElementById("filler")!.innerHTML = filler(25, 1);
document.getElementById("filler-2")!.innerHTML = filler(25, 26);

// --- QR code (desktop only) ------------------------------------------------------

const networkUrl = document.querySelector<HTMLMetaElement>('meta[name="network-url"]')?.content;
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if (networkUrl && isLocal) {
  const url = new URL(location.pathname + location.search, networkUrl).href;
  document.getElementById("qr")!.style.display = "flex";
  document.getElementById("qr-url")!.textContent = url;
  void QRCode.toCanvas(document.getElementById("qr-canvas") as HTMLCanvasElement, url, { width: 140, margin: 0 });
}

if (new URLSearchParams(location.search).has("from")) log(`arrived via ${new URLSearchParams(location.search).get("from")}`);
