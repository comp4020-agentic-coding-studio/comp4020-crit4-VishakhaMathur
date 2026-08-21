// The Friction Pad --- a full-screen instrument: pointer velocity drives
// both the trail's colour/thickness and a live-synthesised tone.

const canvasEl = document.querySelector<HTMLCanvasElement>("#pad");
if (!canvasEl) throw new Error("#pad canvas not found");
const canvas: HTMLCanvasElement = canvasEl;

const context = canvas.getContext("2d");
if (!context) throw new Error("2d canvas context unavailable");
const ctx: CanvasRenderingContext2D = context;

// Line width in CSS px at zero and at "as fast as anyone actually drags".
const MIN_LINE_WIDTH = 2;
const MAX_LINE_WIDTH = 46;
// px/ms of pointer travel that maxes the line out --- tuned by feel.
const MAX_VELOCITY = 1.8;
// How fast the smoothed velocity chases the instantaneous one, 0..1.
// Low = smoother taper but laggier response; without this, per-sample
// jitter made the width spike on every tiny wobble and, combined with
// round line caps on a segment shorter than its own width, rendered as
// a circle instead of a line.
const VELOCITY_SMOOTHING = 0.25;
// Alpha of the per-frame fade rectangle; lower = longer-lived trail.
const FADE_ALPHA = 0.06;
// Degrees of hue rotation per CSS px travelled, so faster strokes rainbow
// through colour faster --- speed and colour come from the same signal.
const HUE_PER_PX = 0.6;

let width = 0;
let height = 0;

function resize(): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  // All drawing below is in CSS px; this maps it onto the backing device
  // pixels so strokes stay crisp on high-DPI screens.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener("resize", resize);

interface Point {
  x: number;
  y: number;
}

interface StrokeState {
  // Last two committed points: the curve for each new sample is drawn
  // through the midpoints either side of p1, which is what turns a jagged
  // polyline into a smooth ribbon.
  p0: Point;
  p1: Point;
  t: number;
  hue: number;
  velocity: number;
}

// One in-progress stroke per active pointer, so multiple fingers each draw
// their own independent, independently-coloured line.
const strokes = new Map<number, StrokeState>();
let hueSeed = Math.random() * 360;

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// --- Audio -------------------------------------------------------------
// A shared graph for the whole page, built lazily on the first pointerdown
// so AudioContext construction happens inside a user gesture (autoplay
// policy). Two oscillators --- sine and sawtooth --- run into a shared
// lowpass filter and out through a master gain:
//
//   sineOsc -> sineGain -\
//                         +-> filter (lowpass) -> masterGain -> destination
//   sawOsc  -> sawGain  -/
//
// Velocity (as in step 2) drives pitch and overall loudness. Y drives the
// filter cutoff: top of screen open/bright, bottom closed/muffled. X
// crossfades sine (left) into sawtooth (right).

const overlay = document.querySelector<HTMLElement>("#overlay");

const MIN_FREQUENCY = 80;
const MAX_FREQUENCY = 1200;
const MAX_GAIN = 0.28;
const MIN_FILTER_FREQUENCY = 200;
const MAX_FILTER_FREQUENCY = 9000;
// Seconds. setTargetAtTime glides every audio param toward its target over
// roughly this long instead of jumping there --- jumping is what causes the
// click/pop you get from setting .value directly on a live audio param.
const AUDIO_TIME_CONSTANT = 0.03;

let audioContext: AudioContext | null = null;
let sineOscillator: OscillatorNode | null = null;
let sawOscillator: OscillatorNode | null = null;
let sineGain: GainNode | null = null;
let sawGain: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let masterGain: GainNode | null = null;

function dismissOverlay(): void {
  if (!overlay || overlay.hidden) return;
  overlay.classList.add("hidden");
  window.setTimeout(() => {
    overlay.hidden = true;
  }, 400);
}

function ensureAudioStarted(): void {
  if (audioContext) return;
  audioContext = new AudioContext();

  sineOscillator = audioContext.createOscillator();
  sawOscillator = audioContext.createOscillator();
  sineOscillator.type = "sine";
  sawOscillator.type = "sawtooth";
  sineOscillator.frequency.value = MIN_FREQUENCY;
  sawOscillator.frequency.value = MIN_FREQUENCY;

  // Far left = pure sine, far right = pure sawtooth.
  sineGain = audioContext.createGain();
  sawGain = audioContext.createGain();
  sineGain.gain.value = 1;
  sawGain.gain.value = 0;

  filter = audioContext.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = MIN_FILTER_FREQUENCY;

  masterGain = audioContext.createGain();
  masterGain.gain.value = 0;

  sineOscillator.connect(sineGain).connect(filter);
  sawOscillator.connect(sawGain).connect(filter);
  filter.connect(masterGain).connect(audioContext.destination);

  sineOscillator.start();
  sawOscillator.start();
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

function updateAudio(point: Point, pxPerMs: number): void {
  if (!audioContext || !sineOscillator || !sawOscillator) return;
  if (!sineGain || !sawGain || !filter || !masterGain) return;
  const now = audioContext.currentTime;

  const velocityT = Math.min(pxPerMs / MAX_VELOCITY, 1);
  const frequency = MIN_FREQUENCY + velocityT * (MAX_FREQUENCY - MIN_FREQUENCY);
  sineOscillator.frequency.setTargetAtTime(frequency, now, AUDIO_TIME_CONSTANT);
  sawOscillator.frequency.setTargetAtTime(frequency, now, AUDIO_TIME_CONSTANT);
  masterGain.gain.setTargetAtTime(velocityT * MAX_GAIN, now, AUDIO_TIME_CONSTANT);

  // y = 0 at the top of the screen: invert so top is open/bright.
  const openness = 1 - clamp01(point.y / height);
  const cutoff = MIN_FILTER_FREQUENCY + openness * (MAX_FILTER_FREQUENCY - MIN_FILTER_FREQUENCY);
  filter.frequency.setTargetAtTime(cutoff, now, AUDIO_TIME_CONSTANT);

  const sawMix = clamp01(point.x / width);
  sineGain.gain.setTargetAtTime(1 - sawMix, now, AUDIO_TIME_CONSTANT);
  sawGain.gain.setTargetAtTime(sawMix, now, AUDIO_TIME_CONSTANT);
}

function silenceAudio(): void {
  if (!audioContext || !masterGain) return;
  masterGain.gain.setTargetAtTime(0, audioContext.currentTime, AUDIO_TIME_CONSTANT);
}

function velocityToWidth(pxPerMs: number): number {
  const t = Math.min(pxPerMs / MAX_VELOCITY, 1);
  return MIN_LINE_WIDTH + t * (MAX_LINE_WIDTH - MIN_LINE_WIDTH);
}

// Starts a stroke's state and leaves the initial mark --- shared by pointer
// touchdown and the keyboard cursor's first movement, so a tap/keypress
// that never moves still leaves a dot.
function startStroke(point: Point, timestamp: number): StrokeState {
  hueSeed = (hueSeed + 47) % 360;
  const state: StrokeState = { p0: point, p1: point, t: timestamp, hue: hueSeed, velocity: 0 };
  ctx.fillStyle = `hsl(${hueSeed}, 85%, 60%)`;
  ctx.beginPath();
  ctx.arc(point.x, point.y, MIN_LINE_WIDTH / 2, 0, Math.PI * 2);
  ctx.fill();
  return state;
}

// The unified engine: one stroke moving to one new point, at one moment ---
// pointer and keyboard input both funnel through this to drive the same
// audio parameters and draw with the same curve-smoothed line.
function advanceStroke(state: StrokeState, point: Point, timestamp: number): void {
  const distance = Math.hypot(point.x - state.p1.x, point.y - state.p1.y);
  const dt = Math.max(timestamp - state.t, 1);
  const instantVelocity = distance / dt;
  state.velocity += (instantVelocity - state.velocity) * VELOCITY_SMOOTHING;
  state.hue = (state.hue + distance * HUE_PER_PX) % 360;
  updateAudio(point, state.velocity);

  ctx.strokeStyle = `hsl(${state.hue}, 85%, 60%)`;
  ctx.lineWidth = velocityToWidth(state.velocity);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(midpoint(state.p0, state.p1).x, midpoint(state.p0, state.p1).y);
  ctx.quadraticCurveTo(
    state.p1.x,
    state.p1.y,
    midpoint(state.p1, point).x,
    midpoint(state.p1, point).y,
  );
  ctx.stroke();

  state.p0 = state.p1;
  state.p1 = point;
  state.t = timestamp;
}

function toPoint(event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function onPointerDown(event: PointerEvent): void {
  dismissOverlay();
  ensureAudioStarted();
  canvas.setPointerCapture(event.pointerId);
  strokes.set(event.pointerId, startStroke(toPoint(event), event.timeStamp));
}

function onPointerMove(event: PointerEvent): void {
  const state = strokes.get(event.pointerId);
  if (!state) return;

  // getCoalescedEvents recovers points the browser batched between frames,
  // so fast strokes on high-polling-rate input still draw an unbroken line.
  const events = event.getCoalescedEvents?.() ?? [];
  for (const raw of events.length > 0 ? events : [event]) {
    advanceStroke(state, toPoint(raw), raw.timeStamp);
  }
}

function endStroke(event: PointerEvent): void {
  strokes.delete(event.pointerId);
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  // Only silence once every pointer has lifted and the keyboard cursor
  // isn't the one keeping things moving.
  if (strokes.size === 0 && !isKeyboardCursorActive()) silenceAudio();
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

// --- Keyboard virtual cursor --------------------------------------------
// Arrow keys and WASD accelerate a virtual cursor instead of jumping it;
// releasing lets drag coast it to a stop. It shares startStroke/advanceStroke
// with pointer input, so the trail and the tone behave identically whichever
// drove them --- only how the (x, y) gets produced each frame differs.

// px/ms^2 --- how hard a held key pushes.
const KEY_ACCELERATION = 0.004;
// Fraction of speed shed per ms, applied continuously; the same constant
// governs both how fast held input reaches cruising speed and how fast it
// coasts to a stop on release.
const KEY_FRICTION = 0.0025;
// Below this speed, with no key held, treat the cursor as fully at rest.
const KEY_REST_SPEED = 0.01;

const pressedKeys = new Set<string>();
const keyboardVelocity: Point = { x: 0, y: 0 };
let keyboardState: StrokeState | null = null;
let keyboardLastFrameTime: number | null = null;

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function directionForKey(key: string): Point | undefined {
  switch (key) {
    case "ArrowUp":
    case "w":
      return { x: 0, y: -1 };
    case "ArrowDown":
    case "s":
      return { x: 0, y: 1 };
    case "ArrowLeft":
    case "a":
      return { x: -1, y: 0 };
    case "ArrowRight":
    case "d":
      return { x: 1, y: 0 };
    default:
      return undefined;
  }
}

function isKeyboardCursorActive(): boolean {
  return pressedKeys.size > 0 || Math.hypot(keyboardVelocity.x, keyboardVelocity.y) > KEY_REST_SPEED;
}

window.addEventListener("keydown", (event) => {
  // Any key --- not just a movement key --- satisfies "press any key to
  // play", same as the first pointerdown does for pointer input.
  dismissOverlay();
  ensureAudioStarted();

  const key = normalizeKey(event.key);
  if (!directionForKey(key)) return;
  event.preventDefault(); // arrow keys otherwise scroll the page
  pressedKeys.add(key);
});

window.addEventListener("keyup", (event) => {
  pressedKeys.delete(normalizeKey(event.key));
});

function updateKeyboardCursor(timestamp: number): void {
  if (keyboardLastFrameTime === null) {
    keyboardLastFrameTime = timestamp;
    return;
  }
  const dt = Math.min(timestamp - keyboardLastFrameTime, 100);
  keyboardLastFrameTime = timestamp;

  let inputX = 0;
  let inputY = 0;
  for (const key of pressedKeys) {
    const direction = directionForKey(key);
    if (!direction) continue;
    inputX += direction.x;
    inputY += direction.y;
  }
  const inputMagnitude = Math.hypot(inputX, inputY);
  if (inputMagnitude > 0) {
    inputX /= inputMagnitude;
    inputY /= inputMagnitude;
  }

  keyboardVelocity.x += inputX * KEY_ACCELERATION * dt;
  keyboardVelocity.y += inputY * KEY_ACCELERATION * dt;

  const drag = Math.max(0, 1 - KEY_FRICTION * dt);
  keyboardVelocity.x *= drag;
  keyboardVelocity.y *= drag;

  const speed = Math.hypot(keyboardVelocity.x, keyboardVelocity.y);
  if (speed > MAX_VELOCITY) {
    keyboardVelocity.x *= MAX_VELOCITY / speed;
    keyboardVelocity.y *= MAX_VELOCITY / speed;
  }

  if (inputMagnitude === 0 && speed < KEY_REST_SPEED) {
    keyboardVelocity.x = 0;
    keyboardVelocity.y = 0;
    return; // at rest --- nothing new to draw or sound
  }

  if (!keyboardState) {
    keyboardState = startStroke({ x: width / 2, y: height / 2 }, timestamp);
  }
  const next: Point = {
    x: clamp(keyboardState.p1.x + keyboardVelocity.x * dt, 0, width),
    y: clamp(keyboardState.p1.y + keyboardVelocity.y * dt, 0, height),
  };
  advanceStroke(keyboardState, next, timestamp);
}

function tick(timestamp: number): void {
  ctx.fillStyle = `rgba(0, 0, 0, ${FADE_ALPHA})`;
  ctx.fillRect(0, 0, width, height);
  updateKeyboardCursor(timestamp);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
