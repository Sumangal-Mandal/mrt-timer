"use strict";

/* ============================================================
   MRT Cycle — playlist-based shareable interval workout timer
   ============================================================ */

const $ = (id) => document.getElementById(id);

const els = {
  setup:          $("setup"),
  timer:          $("timer"),
  done:           $("done"),
  workout:        $("workout"),          // hidden textarea – holds selected workout text
  pasteLink:      $("paste-link"),
  loadLink:       $("load-link"),
  linkStatus:     $("link-status"),
  parseError:     $("parse-error"),
  startBtn:       $("start-btn"),
  shareBtn:       $("share-btn"),
  playlistEl:     $("playlist"),
  plLoading:      $("playlist-loading"),
  plError:        $("playlist-error"),
  customSection:  $("custom-section"),
  quitBtn:        $("quit-btn"),
  cycleCur:       $("cycle-cur"),
  cycleTotal:     $("cycle-total"),
  phaseLabel:     $("phase-label"),
  ring:           $("ring-progress"),
  count:          $("count"),
  currentExercise:$("current-exercise"),
  nextExercise:   $("next-exercise"),
  progressFill:   $("progress-fill"),
  prevBtn:        $("prev-btn"),
  pauseBtn:       $("pause-btn"),
  skipBtn:        $("skip-btn"),
  doneSummary:    $("done-summary"),
  doneBtn:        $("done-btn"),
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 100;

/* ============================================================
   PARSING
   ============================================================ */

function parseWorkout(text) {
  const opts = { duration: 30, break: 15, cycle: 1 };
  const exercises = [];
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = line.slice(1).trim().match(/^(\w+)\s+(\d+(?:\.\d+)?)/);
      if (m) {
        const key = m[1].toLowerCase();
        const val = Number(m[2]);
        if (key === "duration" || key === "work") opts.duration = val;
        else if (key === "break" || key === "rest") opts.break = val;
        else if (key === "cycle" || key === "cycles" || key === "round" || key === "rounds") opts.cycle = val;
      }
      continue;
    }
    exercises.push(line);
  }
  const errors = [];
  if (!exercises.length) errors.push("Add at least one exercise.");
  if (!(opts.duration > 0)) errors.push("#duration must be > 0.");
  if (opts.break < 0) errors.push("#break cannot be negative.");
  return { opts, exercises, errors };
}

function buildSteps(parsed) {
  const { opts, exercises } = parsed;
  const steps = [];
  const cycles = Math.round(opts.cycle);
  for (let c = 0; c < cycles; c++) {
    for (let e = 0; e < exercises.length; e++) {
      const isLast = c === cycles - 1 && e === exercises.length - 1;
      steps.push({ type: "work", name: exercises[e], seconds: opts.duration, cycle: c + 1 });
      if (opts.break > 0 && !isLast) {
        const next = e + 1 < exercises.length ? exercises[e + 1] : exercises[0];
        steps.push({ type: "rest", name: "Rest", next, seconds: opts.break, cycle: c + 1 });
      }
    }
  }
  return steps;
}

function totalSeconds(parsed) {
  return buildSteps(parsed).reduce((s, x) => s + x.seconds, 0);
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ============================================================
   LINK ENCODING / DECODING
   ============================================================ */

function encodeWorkout(text) {
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeWorkout(code) {
  let b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return decodeURIComponent(escape(atob(b64)));
}
function buildShareUrl(text) {
  return `${location.origin}${location.pathname}#w=${encodeWorkout(text)}`;
}

/* ============================================================
   PLAYLIST RENDERING
   ============================================================ */

let selectedId = null;  // id of currently selected workout card

function statsFor(parsed) {
  const { opts, exercises } = parsed;
  return [
    `${exercises.length} exercises`,
    `${opts.duration}s work`,
    opts.break > 0 ? `${opts.break}s rest` : "no rest",
    `${Math.round(opts.cycle)} cycle${opts.cycle > 1 ? "s" : ""}`,
    fmtTime(totalSeconds(parsed)),
  ];
}

function renderCard(workout) {
  const parsed = parseWorkout(workout.text);
  const chips = statsFor(parsed);

  const card = document.createElement("div");
  card.className = "wcard";
  card.dataset.id = workout.id;

  card.innerHTML = `
    <div class="wcard-head">
      <span class="wcard-emoji">${workout.emoji || "💪"}</span>
      <div class="wcard-info">
        <div class="wcard-name">${escHtml(workout.name)}</div>
        <div class="wcard-meta">
          ${chips.map(c => `<span class="wcard-chip">${escHtml(c)}</span>`).join("")}
        </div>
      </div>
      <div class="wcard-check">✓</div>
    </div>
    <div class="wcard-body" hidden>
      <div class="wcard-exercises">
        ${parsed.exercises.map(e => `<span>${escHtml(e)}</span>`).join("")}
      </div>
    </div>`;

  card.addEventListener("click", () => selectCard(workout.id, workout.text, card));
  return card;
}

function selectCard(id, text, clickedEl) {
  // Deselect previous
  document.querySelectorAll(".wcard.selected").forEach(c => {
    c.classList.remove("selected");
    const body = c.querySelector(".wcard-body");
    if (body) body.hidden = true;
  });

  if (selectedId === id) {
    // Tapping same card again → deselect
    selectedId = null;
    els.workout.value = "";
    setActions(false);
    return;
  }

  selectedId = id;
  els.workout.value = text;
  clickedEl.classList.add("selected");
  const body = clickedEl.querySelector(".wcard-body");
  if (body) body.hidden = false;
  setActions(true);
}

function setActions(enabled) {
  els.startBtn.disabled = !enabled;
  els.shareBtn.disabled = !enabled;
}

function buildPlaylist(workouts) {
  els.plLoading.hidden = true;
  els.playlistEl.hidden = false;
  els.playlistEl.innerHTML = "";

  for (const w of workouts) {
    els.playlistEl.appendChild(renderCard(w));
  }
}

async function loadPlaylist() {
  try {
    const res = await fetch("workouts/index.json?_=" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    buildPlaylist(data.workouts || []);
  } catch (err) {
    els.plLoading.hidden = true;
    els.plError.hidden = false;
    els.plError.textContent = "Could not load workouts. Check your connection and reload.";
  }
}

/* ============================================================
   CUSTOM / PASTE LINK
   ============================================================ */

async function loadFromLink() {
  const input = els.pasteLink.value.trim();
  if (!input) return;
  flashStatus(els.linkStatus, "Loading…");

  let text = null;

  // 1) Our own encoded share link
  const hashMatch = input.match(/[#&]w=([^&\s]+)/);
  if (hashMatch) {
    try { text = decodeWorkout(hashMatch[1]); } catch (_) {}
  }

  // 2) Plain URL → try to fetch
  if (!text && /^https?:\/\//i.test(input)) {
    try {
      const res = await fetch(input, { mode: "cors" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      text = await res.text();
    } catch (_) {
      flashStatus(els.linkStatus, "Could not fetch that link (CORS). Paste the workout text instead.", true);
      return;
    }
  }

  // 3) Treat input itself as raw workout text
  if (!text) text = input;

  const parsed = parseWorkout(text);
  if (!parsed.exercises.length) {
    flashStatus(els.linkStatus, "That doesn't look like a valid workout.", true);
    return;
  }

  flashStatus(els.linkStatus, "Loaded ✓");
  addCustomCard(text);
  els.customSection.removeAttribute("open");
}

function addCustomCard(text) {
  const workout = { id: "__custom__", name: "Custom Workout", emoji: "✨", text };
  // Remove existing custom card if present
  const prev = els.playlistEl.querySelector('[data-id="__custom__"]');
  if (prev) prev.remove();

  const card = renderCard(workout);
  els.playlistEl.hidden = false;
  els.plLoading.hidden = true;
  els.playlistEl.insertBefore(card, els.playlistEl.firstChild);
  // Auto-select
  selectCard("__custom__", text, card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function flashStatus(el, msg, isError) {
  el.textContent = msg;
  el.style.color = isError ? "#fca5a5" : "#86efac";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.textContent = ""), 4000);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ============================================================
   SHARE (Web Share API)
   ============================================================ */

async function shareWorkout() {
  const text = els.workout.value.trim();
  if (!text) return;
  const url = buildShareUrl(text);
  try {
    if (navigator.share) {
      await navigator.share({ title: "MRT Cycle workout", text: "Try this workout:", url });
    } else {
      await copyToClipboard(url);
      alert("Link copied to clipboard!");
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    await copyToClipboard(url);
  }
}

async function copyToClipboard(text) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    prompt("Copy this link:", text);
  }
}

/* ============================================================
   TIMER ENGINE
   ============================================================ */

const engine = {
  steps: [], index: 0, remaining: 0, stepDuration: 0,
  phaseType: "", paused: false, ticker: null,
  lastTick: 0, totalCycles: 1,
};

function showScreen(name) {
  [els.setup, els.timer, els.done].forEach(s => s.classList.remove("active"));
  els[name].classList.add("active");
}

function setPhaseClass(type) {
  document.body.classList.remove("phase-ready", "phase-work", "phase-rest");
  document.body.classList.add(`phase-${type}`);
}

function startWorkout() {
  const text = els.workout.value;
  const parsed = parseWorkout(text);
  if (parsed.errors.length) {
    els.parseError.hidden = false;
    els.parseError.textContent = parsed.errors.join(" ");
    return;
  }
  els.parseError.hidden = true;
  ensureAudio();

  engine.steps = buildSteps(parsed);
  engine.index = 0;
  engine.totalCycles = Math.round(parsed.opts.cycle);
  engine.paused = false;
  els.cycleTotal.textContent = engine.totalCycles;
  els.pauseBtn.textContent = "⏸";

  showScreen("timer");
  keepAwake();
  runReady(3);
}

function runReady(seconds) {
  setPhaseClass("ready");
  els.phaseLabel.textContent = "Get ready";
  els.currentExercise.textContent = engine.steps[0]?.name ?? "—";
  els.nextExercise.textContent = "starting…";
  els.cycleCur.textContent = "1";
  speak("Get ready. " + (engine.steps[0]?.name ?? ""));
  startPhase(seconds, "ready");
}

function loadStep(i) {
  const step = engine.steps[i];
  if (!step) return finishWorkout();

  if (step.type === "work") {
    setPhaseClass("work");
    els.phaseLabel.textContent = "Work";
    els.currentExercise.textContent = step.name;
    const upcoming = engine.steps[i + 1];
    els.nextExercise.textContent = upcoming
      ? (upcoming.type === "rest" ? (upcoming.next || "Rest") : upcoming.name)
      : "Finish";
    els.cycleCur.textContent = step.cycle;
    speak(step.name);
  } else {
    setPhaseClass("rest");
    els.phaseLabel.textContent = "Rest";
    els.currentExercise.textContent = "Rest";
    els.nextExercise.textContent = step.next || "—";
    els.cycleCur.textContent = step.cycle;
    speak("Rest. Next up, " + (step.next || ""));
  }
  startPhase(step.seconds, step.type);
}

function startPhase(seconds, type) {
  engine.remaining = seconds;
  engine.stepDuration = seconds;
  engine.phaseType = type;
  engine.lastTick = performance.now();
  updateTimerUI(seconds, seconds);
  clearInterval(engine.ticker);
  engine.ticker = setInterval(tick, 100);
}

function tick() {
  if (engine.paused) { engine.lastTick = performance.now(); return; }
  const now = performance.now();
  const dt = (now - engine.lastTick) / 1000;
  engine.lastTick = now;

  const before = Math.ceil(engine.remaining);
  engine.remaining -= dt;
  const after = Math.ceil(engine.remaining);

  if (after < before && after >= 1 && after <= 3) beep(660, 0.12, 0.3);

  if (engine.remaining <= 0) {
    beep(990, 0.3, 0.35);
    clearInterval(engine.ticker);
    if (engine.phaseType === "ready") { loadStep(0); }
    else { engine.index += 1; loadStep(engine.index); }
    return;
  }
  updateTimerUI(engine.remaining, engine.stepDuration);
}

function updateTimerUI(remaining, duration) {
  els.count.textContent = Math.ceil(remaining);
  const frac = duration > 0 ? Math.max(0, remaining / duration) : 0;
  els.ring.style.strokeDasharray = RING_CIRCUMFERENCE;
  els.ring.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - frac)).toFixed(2);

  const totalSteps = engine.steps.length || 1;
  const stepFrac = engine.stepDuration > 0 ? 1 - remaining / engine.stepDuration : 0;
  els.progressFill.style.width =
    `${Math.min(100, Math.max(0, (engine.index + stepFrac) / totalSteps * 100))}%`;
}

function togglePause() {
  engine.paused = !engine.paused;
  els.pauseBtn.textContent = engine.paused ? "▶" : "⏸";
  els.phaseLabel.textContent = engine.paused
    ? "Paused"
    : engine.phaseType === "rest" ? "Rest"
    : engine.phaseType === "ready" ? "Get ready"
    : "Work";
  if (engine.paused) window.speechSynthesis?.cancel();
}

function skipStep() {
  clearInterval(engine.ticker);
  if (engine.phaseType === "ready") { loadStep(0); return; }
  engine.index += 1;
  loadStep(engine.index);
}

function prevStep() {
  clearInterval(engine.ticker);
  if (engine.phaseType === "ready") { startPhase(engine.stepDuration, "ready"); return; }
  if (engine.stepDuration - engine.remaining > 2 || engine.index === 0) {
    loadStep(engine.index);
  } else {
    engine.index = Math.max(0, engine.index - 1);
    loadStep(engine.index);
  }
}

function finishWorkout() {
  clearInterval(engine.ticker);
  releaseWake();
  document.body.classList.remove("phase-ready", "phase-work", "phase-rest");
  speak("Workout complete. Great job!");
  beep(880, 0.2, 0.3);
  setTimeout(() => beep(1180, 0.35, 0.3), 180);
  const done = engine.steps.filter(s => s.type === "work").length;
  els.doneSummary.textContent =
    `${done} exercise sets · ${engine.totalCycles} cycle${engine.totalCycles > 1 ? "s" : ""} done.`;
  showScreen("done");
}

function quitWorkout() {
  clearInterval(engine.ticker);
  releaseWake();
  window.speechSynthesis?.cancel();
  document.body.classList.remove("phase-ready", "phase-work", "phase-rest");
  showScreen("setup");
}

/* ============================================================
   AUDIO
   ============================================================ */

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx?.state === "suspended") audioCtx.resume();
}
function beep(freq = 880, dur = 0.15, vol = 0.25) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq; osc.type = "sine";
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + dur);
}
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch (_) {}
}

/* ============================================================
   WAKE LOCK
   ============================================================ */

let wakeLock = null;
async function keepAwake() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (_) {}
}
function releaseWake() {
  try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (_) {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && els.timer.classList.contains("active")) keepAwake();
});

/* ============================================================
   INIT
   ============================================================ */

const BUILD = "v8";

function init() {
  const tag = document.getElementById("build-tag");
  if (tag) tag.textContent = "build " + BUILD;

  // Wire timer controls
  els.startBtn.addEventListener("click", () => { ensureAudio(); startWorkout(); });
  els.shareBtn.addEventListener("click", shareWorkout);
  els.loadLink.addEventListener("click", loadFromLink);
  els.pasteLink.addEventListener("keydown", e => { if (e.key === "Enter") loadFromLink(); });
  els.quitBtn.addEventListener("click", quitWorkout);
  els.pauseBtn.addEventListener("click", () => { ensureAudio(); togglePause(); });
  els.skipBtn.addEventListener("click", skipStep);
  els.prevBtn.addEventListener("click", prevStep);
  els.doneBtn.addEventListener("click", () => showScreen("setup"));

  // If opened via a share link, add it as a custom card and auto-select
  const hashMatch = location.hash.match(/[#&]w=([^&\s]+)/);
  if (hashMatch) {
    try {
      const text = decodeWorkout(hashMatch[1]);
      // Load playlist then prepend the shared card
      loadPlaylist().then(() => addCustomCard(text));
    } catch (_) {
      loadPlaylist();
    }
  } else {
    loadPlaylist();
  }

  if ("serviceWorker" in navigator) {
    // updateViaCache:"none" → always fetch sw.js fresh so new versions are detected.
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((reg) => {
        reg.update();
        // Periodically check for a new version while the app is open.
        setInterval(() => reg.update(), 60 * 1000);
      })
      .catch(() => {});

    // When a newly installed SW takes control, reload once to load fresh assets.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
