"use strict";

/* ============================================================
   MRT Cycle — a shareable interval workout timer
   ============================================================ */

const DEFAULT_WORKOUT = `#duration 20
#break 10
#cycle 4
jumping jacks
squat taps
high knees
mountain climbers
push up jacks`;

const $ = (id) => document.getElementById(id);

const els = {
  setup: $("setup"),
  timer: $("timer"),
  done: $("done"),
  workout: $("workout"),
  pasteLink: $("paste-link"),
  loadLink: $("load-link"),
  linkStatus: $("link-status"),
  parseError: $("parse-error"),
  preview: $("preview"),
  pvEx: $("pv-ex"),
  pvDur: $("pv-dur"),
  pvBrk: $("pv-brk"),
  pvCyc: $("pv-cyc"),
  pvTotal: $("pv-total"),
  startBtn: $("start-btn"),
  shareBtn: $("share-btn"),
  quitBtn: $("quit-btn"),
  cycleCur: $("cycle-cur"),
  cycleTotal: $("cycle-total"),
  phaseLabel: $("phase-label"),
  ring: $("ring-progress"),
  count: $("count"),
  currentExercise: $("current-exercise"),
  nextExercise: $("next-exercise"),
  progressFill: $("progress-fill"),
  prevBtn: $("prev-btn"),
  pauseBtn: $("pause-btn"),
  skipBtn: $("skip-btn"),
  doneSummary: $("done-summary"),
  doneBtn: $("done-btn"),
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 100; // r = 100

/* ---------- Parsing ---------- */
function parseWorkout(text) {
  const opts = { duration: 30, break: 15, cycle: 1 };
  const exercises = [];
  const lines = (text || "").split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = line.slice(1).trim().match(/^(\w+)\s+(\d+(?:\.\d+)?)/);
      if (m) {
        const key = m[1].toLowerCase();
        const val = Number(m[2]);
        if (key === "duration" || key === "work") opts.duration = val;
        else if (key === "break" || key === "rest") opts.break = val;
        else if (key === "cycle" || key === "cycles" || key === "rounds" || key === "round") opts.cycle = val;
      }
      continue;
    }
    exercises.push(line);
  }

  const errors = [];
  if (exercises.length === 0) errors.push("Add at least one exercise line.");
  if (!(opts.duration > 0)) errors.push("#duration must be greater than 0.");
  if (!(opts.cycle >= 1)) errors.push("#cycle must be at least 1.");
  if (opts.break < 0) errors.push("#break cannot be negative.");

  return { opts, exercises, errors };
}

/* Build a flat list of phases: work / rest, skipping the very last rest. */
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
  return buildSteps(parsed).reduce((sum, s) => sum + s.seconds, 0);
}

function fmtTime(total) {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ---------- Link encoding ---------- */
function encodeWorkout(text) {
  // URL-safe base64 of UTF-8 text
  const b64 = btoa(unescape(encodeURIComponent(text)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeWorkout(code) {
  let b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return decodeURIComponent(escape(atob(b64)));
}
function buildShareUrl(text) {
  const base = location.origin + location.pathname;
  return `${base}#w=${encodeWorkout(text)}`;
}

/* ---------- Preview / validation ---------- */
function refreshPreview() {
  const parsed = parseWorkout(els.workout.value);
  if (parsed.errors.length) {
    els.parseError.hidden = false;
    els.parseError.textContent = parsed.errors.join(" ");
    els.preview.hidden = true;
    els.startBtn.disabled = true;
    els.startBtn.style.opacity = "0.5";
    return null;
  }
  els.parseError.hidden = true;
  els.preview.hidden = false;
  els.startBtn.disabled = false;
  els.startBtn.style.opacity = "1";

  els.pvEx.textContent = parsed.exercises.length;
  els.pvDur.textContent = `${parsed.opts.duration}s`;
  els.pvBrk.textContent = `${parsed.opts.break}s`;
  els.pvCyc.textContent = Math.round(parsed.opts.cycle);
  els.pvTotal.textContent = fmtTime(totalSeconds(parsed));
  return parsed;
}

/* ---------- Audio cues ---------- */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}
function beep(freq = 880, duration = 0.15, volume = 0.25) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch (_) {}
}

/* ---------- Timer engine ---------- */
const engine = {
  steps: [],
  index: 0,
  remaining: 0,
  stepDuration: 0,
  paused: false,
  ticker: null,
  lastTick: 0,
  totalCycles: 1,
};

function showScreen(name) {
  for (const s of [els.setup, els.timer, els.done]) s.classList.remove("active");
  els[name].classList.add("active");
}

function setPhaseClass(type) {
  document.body.classList.remove("phase-ready", "phase-work", "phase-rest");
  document.body.classList.add(`phase-${type}`);
}

function startWorkout() {
  const parsed = refreshPreview();
  if (!parsed) return;
  ensureAudio();

  engine.steps = buildSteps(parsed);
  engine.index = 0;
  engine.totalCycles = Math.round(parsed.opts.cycle);
  engine.paused = false;
  els.cycleTotal.textContent = engine.totalCycles;
  els.pauseBtn.textContent = "⏸";

  showScreen("timer");
  keepAwake();

  // Short "get ready" lead-in
  runReady(3);
}

function runReady(seconds) {
  setPhaseClass("ready");
  els.phaseLabel.textContent = "Get ready";
  els.currentExercise.textContent = engine.steps[0] ? engine.steps[0].name : "—";
  els.nextExercise.textContent = "starting…";
  els.nextExercise.parentElement.style.visibility = "visible";
  els.cycleCur.textContent = "1";
  speak("Get ready. " + (engine.steps[0] ? engine.steps[0].name : ""));
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
    const nextName = upcoming
      ? (upcoming.type === "rest" ? (upcoming.next || "Rest") : upcoming.name)
      : "Finish";
    els.nextExercise.textContent = nextName;
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

  // Countdown beeps on 3,2,1
  if (after < before && after >= 1 && after <= 3) beep(660, 0.12, 0.3);

  if (engine.remaining <= 0) {
    beep(990, 0.3, 0.35);
    clearInterval(engine.ticker);
    if (engine.phaseType === "ready") {
      loadStep(0);
    } else {
      engine.index += 1;
      loadStep(engine.index);
    }
    return;
  }
  updateTimerUI(engine.remaining, engine.stepDuration);
}

function updateTimerUI(remaining, duration) {
  els.count.textContent = Math.ceil(remaining);
  const frac = duration > 0 ? Math.max(0, remaining / duration) : 0;
  els.ring.style.strokeDasharray = RING_CIRCUMFERENCE;
  els.ring.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - frac)).toFixed(2);

  // Overall progress across all steps
  const totalSteps = engine.steps.length || 1;
  const stepFrac = engine.stepDuration > 0 ? 1 - remaining / engine.stepDuration : 0;
  const overall = ((engine.index + stepFrac) / totalSteps) * 100;
  els.progressFill.style.width = `${Math.min(100, Math.max(0, overall))}%`;
}

function togglePause() {
  engine.paused = !engine.paused;
  els.pauseBtn.textContent = engine.paused ? "▶" : "⏸";
  els.phaseLabel.textContent = engine.paused ? "Paused" : (engine.phaseType === "rest" ? "Rest" : engine.phaseType === "ready" ? "Get ready" : "Work");
  if (engine.paused) window.speechSynthesis && window.speechSynthesis.cancel();
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
  // If more than 2s into current step, restart it; otherwise go back one.
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
  const done = engine.steps.filter((s) => s.type === "work").length;
  els.doneSummary.textContent = `You finished ${done} exercise sets across ${engine.totalCycles} cycle${engine.totalCycles > 1 ? "s" : ""}.`;
  showScreen("done");
}

function quitWorkout() {
  clearInterval(engine.ticker);
  releaseWake();
  window.speechSynthesis && window.speechSynthesis.cancel();
  document.body.classList.remove("phase-ready", "phase-work", "phase-rest");
  showScreen("setup");
}

/* ---------- Wake lock (keep screen on) ---------- */
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

/* ---------- Share ---------- */
async function shareLink() {
  const parsed = refreshPreview();
  if (!parsed) return;
  const url = buildShareUrl(els.workout.value.trim());
  const shareData = {
    title: "MRT Cycle workout",
    text: "Try this workout:",
    url,
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      flashStatus(els.linkStatus, "Link copied to clipboard ✓");
    } else {
      prompt("Copy this link:", url);
    }
  } catch (err) {
    if (err && err.name === "AbortError") return; // user cancelled
    try {
      await navigator.clipboard.writeText(url);
      flashStatus(els.linkStatus, "Link copied to clipboard ✓");
    } catch (_) {
      prompt("Copy this link:", url);
    }
  }
}

function flashStatus(el, msg, isError) {
  el.textContent = msg;
  el.style.color = isError ? "#fca5a5" : "#86efac";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.textContent = ""), 4000);
}

/* ---------- Load from a pasted link ---------- */
async function loadFromLink() {
  const input = els.pasteLink.value.trim();
  if (!input) return;
  flashStatus(els.linkStatus, "Loading…");

  // 1) Our own encoded link (#w=…)
  const hashMatch = input.match(/[#&]w=([^&\s]+)/);
  if (hashMatch) {
    try {
      els.workout.value = decodeWorkout(hashMatch[1]);
      refreshPreview();
      flashStatus(els.linkStatus, "Workout loaded ✓");
      return;
    } catch (_) {
      flashStatus(els.linkStatus, "Could not decode that link.", true);
    }
  }

  // 2) A plain URL pointing at raw workout text — try to fetch it.
  if (/^https?:\/\//i.test(input)) {
    try {
      const res = await fetch(input, { mode: "cors" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      const parsed = parseWorkout(text);
      if (parsed.exercises.length === 0) throw new Error("No exercises found");
      els.workout.value = text.trim();
      refreshPreview();
      flashStatus(els.linkStatus, "Workout fetched ✓");
    } catch (err) {
      flashStatus(els.linkStatus, "Couldn't fetch that link (it may block cross-origin requests). Paste the text instead.", true);
    }
    return;
  }

  // 3) Treat the pasted content as raw workout text.
  const parsed = parseWorkout(input);
  if (parsed.exercises.length) {
    els.workout.value = input;
    refreshPreview();
    flashStatus(els.linkStatus, "Workout loaded ✓");
  } else {
    flashStatus(els.linkStatus, "That doesn't look like a workout link or text.", true);
  }
}

/* ---------- Init ---------- */
function loadFromCurrentUrl() {
  const m = location.hash.match(/[#&]w=([^&\s]+)/);
  if (m) {
    try {
      els.workout.value = decodeWorkout(m[1]);
      return true;
    } catch (_) {}
  }
  return false;
}

function init() {
  if (!loadFromCurrentUrl()) {
    els.workout.value = DEFAULT_WORKOUT;
  }
  refreshPreview();

  els.workout.addEventListener("input", refreshPreview);
  els.startBtn.addEventListener("click", startWorkout);
  els.shareBtn.addEventListener("click", shareLink);
  els.loadLink.addEventListener("click", loadFromLink);
  els.pasteLink.addEventListener("keydown", (e) => { if (e.key === "Enter") loadFromLink(); });

  els.quitBtn.addEventListener("click", quitWorkout);
  els.pauseBtn.addEventListener("click", () => { ensureAudio(); togglePause(); });
  els.skipBtn.addEventListener("click", skipStep);
  els.prevBtn.addEventListener("click", prevStep);
  els.doneBtn.addEventListener("click", () => showScreen("setup"));

  // Register service worker for offline / installable PWA
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
