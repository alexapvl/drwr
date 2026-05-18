import { Sheet, type SheetAlign } from "../src/index.js";
import "../src/styles.css";

const container = document.getElementById("my-sheet")!;
const trackEl = document.getElementById("snap-track")!;
const buttonsEl = document.getElementById("snap-buttons")!;
const widthSlider = document.getElementById("width-slider") as HTMLInputElement;
const widthVal = document.getElementById("width-val")!;
const alignBtns = document.querySelectorAll<HTMLButtonElement>(".align-btn");
const installTabs = document.querySelectorAll<HTMLButtonElement>(".install-tab");
const installCommand = document.getElementById("install-command")!;
const copyInstall = document.getElementById("copy-install") as HTMLButtonElement;

let snapPoints = [0, 0.3, 0.6, 1.0];
let activeInstallManager = "pnpm";

const installCommands: Record<string, string> = {
  pnpm: "pnpm add @alexapvl/drwr",
  bun: "bun add @alexapvl/drwr",
  yarn: "yarn add @alexapvl/drwr",
  npm: "npm install @alexapvl/drwr",
};

const sheet = new Sheet(container, {
  snapPoints,
  defaultSnap: 0,
  overlay: true,
  dragHandle: true,
  sidePadding: 8,
  onSnap: (point) => console.log("snapped to", point),
});

const initialWidth = window.innerWidth >= 768 ? 60 : 100;
widthSlider.value = String(initialWidth);
widthVal.textContent = `${initialWidth}%`;

widthSlider.addEventListener("input", () => {
  const w = parseInt(widthSlider.value);
  widthVal.textContent = `${w}%`;
  sheet.setLayout({ width: w });
});

alignBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    alignBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    sheet.setLayout({ align: btn.dataset.align as SheetAlign });
  });
});

function setInstallManager(manager: string) {
  if (!installCommands[manager] || manager === activeInstallManager) return;
  activeInstallManager = manager;

  installTabs.forEach((tab) => {
    const active = tab.dataset.manager === manager;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  installCommand.classList.add("switching");
  window.setTimeout(() => {
    installCommand.textContent = installCommands[manager];
    installCommand.classList.remove("switching");
  }, 120);
}

installTabs.forEach((tab) => {
  tab.addEventListener("click", () => setInstallManager(tab.dataset.manager ?? "pnpm"));
});

const copyIcon = copyInstall.innerHTML;
const copiedIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 6 9 17l-5-5"></path>
  </svg>
`;

copyInstall.addEventListener("click", async () => {
  const command = installCommands[activeInstallManager];

  try {
    await navigator.clipboard.writeText(command);
    copyInstall.innerHTML = copiedIcon;
    copyInstall.title = "Copied";
    copyInstall.classList.add("copied");
    window.setTimeout(() => {
      copyInstall.innerHTML = copyIcon;
      copyInstall.title = "Copy";
      copyInstall.classList.remove("copied");
    }, 1400);
  } catch {
    window.prompt("Copy install command", command);
  }
});

const TRACK_MAX = 1;

function valFromX(clientX: number): number {
  const rect = trackEl.getBoundingClientRect();
  const raw = (clientX - rect.left) / rect.width;
  const val = raw * TRACK_MAX;
  const clamped = Math.max(0.05, Math.min(TRACK_MAX, val));
  return Math.round(clamped * 20) / 20; // snap to 0.05 increments
}

function valToPercent(val: number): number {
  return (val / TRACK_MAX) * 100;
}

function renderMarkers() {
  // Remove old markers
  trackEl.querySelectorAll(".snap-marker").forEach((el) => el.remove());

  const nonZero = snapPoints.filter((p) => p > 0).sort((a, b) => a - b);

  for (const p of nonZero) {
    const marker = document.createElement("div");
    marker.className = "snap-marker";
    marker.style.left = `${valToPercent(p)}%`;

    const label = document.createElement("div");
    label.className = "snap-marker-label";
    label.textContent = String(p);
    marker.appendChild(label);

    let dragging = false;
    let currentVal = p;

    marker.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      dragging = true;
      marker.setPointerCapture(e.pointerId);
    });

    marker.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const newVal = valFromX(e.clientX);
      if (newVal > 0 && newVal !== currentVal && !snapPoints.some((s) => s !== currentVal && s === newVal)) {
        const idx = snapPoints.indexOf(currentVal);
        if (idx !== -1) {
          snapPoints[idx] = newVal;
          currentVal = newVal;
          marker.style.left = `${valToPercent(newVal)}%`;
          label.textContent = String(newVal);
          sheet.setSnapPoints([...snapPoints]);
          renderButtons();
        }
      }
    });

    marker.addEventListener("pointerup", () => {
      dragging = false;
      renderMarkers();
    });

    trackEl.appendChild(marker);
  }
}

function renderButtons() {
  buttonsEl.innerHTML = "";
  const nonZero = snapPoints.filter((p) => p > 0).sort((a, b) => a - b);
  for (const p of nonZero) {
    const btn = document.createElement("button");
    btn.className = "btn btn-outline";
    btn.textContent = String(p);
    btn.addEventListener("click", () => sheet.snapTo(p));
    buttonsEl.appendChild(btn);
  }
}

// Double-tap on track to add/remove snap points
let lastTapTime = 0;
let lastTapX = 0;
const DOUBLE_TAP_DELAY = 400;
const DOUBLE_TAP_DISTANCE = 30;

trackEl.addEventListener("click", (e) => e.preventDefault());
trackEl.addEventListener("dblclick", (e) => e.preventDefault());
trackEl.addEventListener("pointerup", (e) => {
  const now = Date.now();
  const dx = Math.abs(e.clientX - lastTapX);

  if (now - lastTapTime < DOUBLE_TAP_DELAY && dx < DOUBLE_TAP_DISTANCE) {
    // Double tap detected
    const val = valFromX(e.clientX);
    if (val <= 0) return;

    const existing = snapPoints.find((s) => s === val);
    if (existing !== undefined && existing > 0 && snapPoints.filter((s) => s > 0).length > 1) {
      snapPoints = snapPoints.filter((s) => s !== existing);
      if (!snapPoints.includes(0)) snapPoints.unshift(0);
    } else if (!existing && snapPoints.filter((s) => s > 0).length < 5) {
      snapPoints.push(val);
      snapPoints.sort((a, b) => a - b);
    }

    sheet.setSnapPoints([...snapPoints]);
    renderMarkers();
    renderButtons();
    lastTapTime = 0;
  } else {
    lastTapTime = now;
    lastTapX = e.clientX;
  }
});

renderMarkers();
renderButtons();
