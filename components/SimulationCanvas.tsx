"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { bodySupport, clamp, rampFrame, rampVertices } from "@/lib/geometry";
import { getDuration, sampleScene, type AnalyticalBody, type AnalyticalForce, type AnalyticalFrame } from "@/lib/engine";
import type { Scene, SceneBody } from "@/lib/schema";

// The canvas is a pure view. Every position it draws comes from sampleScene, so
// the diagram is an exact evaluation of the closed form model rather than a
// stepped integration, and the requestAnimationFrame loop only owns the clock.

export interface SimulationCanvasProps {
  scene: Scene;
  playing: boolean;
  resetKey: number;
  showOverlays: boolean;
  /** Local data URLs keyed by body id, cropped from the picture the user drew. */
  sprites?: Record<string, string>;
  onFrame?: (frame: AnalyticalFrame) => void;
  onComplete?: () => void;
}

const MAX_FRAME_SECONDS = 1 / 20;
const HIDDEN_GAP_SECONDS = 0.25;
const REPORT_INTERVAL_MS = 100;
const TRAIL_STEP_SECONDS = 1 / 60;
const MAX_TRAIL_POINTS = 1800;
const MAX_TRAIL_DRAWN = 260;
const ARROW_MAX_PX = 118;
const ARROW_MIN_PX = 12;
const ARROW_PEAK_PX = 68;
const CHIP_FONT_PX = 11.5;
const TINY_FONT_PX = 10.5;

const CHALK = "#f2f7f1";
const CHALK_SOFT = "rgba(242, 247, 241, 0.55)";
const MINT = "#b8f0d8";
const PEACH = "#ffd7bf";
const LAVENDER = "#d9d2f5";
const SAND = "#f6e2a6";
const STATIC_FILL = "rgba(242, 247, 241, 0.13)";
const GRID_MINOR = "rgba(242, 247, 241, 0.075)";
const GRID_MAJOR = "rgba(242, 247, 241, 0.2)";
const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const FORCE_COLOUR: Record<AnalyticalForce["kind"], string> = {
  gravity: PEACH,
  normal: LAVENDER,
  friction: MINT,
  spring: CHALK,
  applied: SAND,
};

interface View {
  k: number;
  ox: number;
  oy: number;
}

interface Point {
  x: number;
  y: number;
}

interface TrailPoint extends Point {
  t: number;
}

interface PaintOptions {
  width: number;
  height: number;
  overlays: boolean;
  trail: TrailPoint[];
}

const toPixel = (view: View, x: number, y: number): Point => ({ x: view.ox + x * view.k, y: view.oy - y * view.k });

// The world is laid out exactly as scene.world says, in metres times
// pixelsPerMeter, with the y axis flipped, and then fitted into the element with
// one uniform scale so nothing is stretched.
function makeView(scene: Scene, width: number, height: number): View {
  const ppm = scene.world.pixelsPerMeter;
  const worldWidthPx = scene.world.width * ppm;
  const worldHeightPx = scene.world.height * ppm;
  const scale = Math.min(width / worldWidthPx, height / worldHeightPx);
  const k = ppm * scale;
  return {
    k,
    ox: (width - worldWidthPx * scale) / 2,
    oy: (height - worldHeightPx * scale) / 2 + worldHeightPx * k,
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function paintChip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bounds: Bounds, colour: string): void {
  ctx.save();
  ctx.font = `650 ${CHIP_FONT_PX}px ${FONT_STACK}`;
  const padX = 5;
  const padY = 3.5;
  const w = ctx.measureText(text).width + padX * 2;
  const h = CHIP_FONT_PX * 1.3 + padY * 2;
  const left = clamp(x - w / 2, bounds.left, Math.max(bounds.left, bounds.right - w));
  const top = clamp(y - h / 2, bounds.top, Math.max(bounds.top, bounds.bottom - h));
  roundRect(ctx, left, top, w, h, 5);
  ctx.fillStyle = "rgba(10, 24, 19, 0.84)";
  ctx.fill();
  ctx.strokeStyle = "rgba(242, 247, 241, 0.2)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + padX, top + h / 2 + 0.5);
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, scene: Scene, view: View): void {
  const left = view.ox;
  const top = view.oy - scene.world.height * view.k;
  const w = scene.world.width * view.k;
  const h = scene.world.height * view.k;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, w, h);
  ctx.clip();

  ctx.lineWidth = 1;
  for (let x = 0; x <= scene.world.width + 1e-9; x += 1) {
    const major = Math.abs(x % 5) < 1e-9;
    ctx.strokeStyle = major ? GRID_MAJOR : GRID_MINOR;
    const px = Math.round(toPixel(view, x, 0).x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px, top + h);
    ctx.stroke();
  }
  for (let y = 0; y <= scene.world.height + 1e-9; y += 1) {
    const major = Math.abs(y % 5) < 1e-9;
    ctx.strokeStyle = major ? GRID_MAJOR : GRID_MINOR;
    const py = Math.round(toPixel(view, 0, y).y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(left + w, py);
    ctx.stroke();
  }

  // Axes and metre ticks read as chalk marks rather than a chart frame.
  ctx.strokeStyle = "rgba(242, 247, 241, 0.42)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  const origin = toPixel(view, 0, 0);
  const cornerX = toPixel(view, scene.world.width, 0);
  const cornerY = toPixel(view, 0, scene.world.height);
  ctx.moveTo(origin.x, top);
  ctx.lineTo(origin.x, top + h);
  ctx.moveTo(left, origin.y);
  ctx.lineTo(left + w, origin.y);
  ctx.stroke();

  ctx.fillStyle = CHALK_SOFT;
  ctx.font = `500 ${TINY_FONT_PX}px ${FONT_STACK}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  for (let x = 0; x <= scene.world.width + 1e-9; x += 5) {
    const p = toPixel(view, x, 0);
    if (p.y + 3 > top + h) continue;
    ctx.fillText(`${x} m`, p.x, Math.min(p.y + 3, top + h - TINY_FONT_PX - 1));
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let y = 0; y <= scene.world.height + 1e-9; y += 5) {
    const p = toPixel(view, 0, y);
    if (p.y < top + 2) continue;
    ctx.fillText(`${y}`, p.x - 4, p.y);
  }
  ctx.restore();
}

function bodyFill(body: SceneBody, index: number): string {
  if (body.isStatic) return STATIC_FILL;
  if (body.kind === "ball") return PEACH;
  if (body.kind === "block") return MINT;
  return [MINT, PEACH, LAVENDER][index % 3];
}

// A static body is chalked white, a moving one is pastel. The second pass with a
// hair of offset stands in for a hand drawn edge without random jitter, so the
// picture is stable between frames.
function chalkShape(ctx: CanvasRenderingContext2D, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "rgba(242, 247, 241, 0.9)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.save();
  ctx.translate(0.6, 0.7);
  ctx.strokeStyle = "rgba(242, 247, 241, 0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawStatic(ctx: CanvasRenderingContext2D, scene: Scene, view: View): void {
  ctx.save();
  ctx.lineCap = "round";
  scene.bodies.forEach((body, index) => {
    if (!body.isStatic) return;
    if (body.kind === "ramp") {
      const [a, b, c] = rampVertices(body).map((vertex) => toPixel(view, vertex.x, vertex.y));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      chalkShape(ctx, "rgba(242, 247, 241, 0.1)");
      return;
    }
    const half = (body.width * view.k) / 2;
    const tall = (body.height * view.k) / 2;
    const centre = toPixel(view, body.x, body.y);
    ctx.save();
    ctx.translate(centre.x, centre.y);
    ctx.rotate((-body.angleDeg * Math.PI) / 180);
    ctx.beginPath();
    ctx.rect(-half, -tall, half * 2, tall * 2);
    chalkShape(ctx, index % 2 === 0 ? STATIC_FILL : "rgba(242, 247, 241, 0.2)");
    ctx.restore();
  });
  ctx.restore();
}

function drawTrail(ctx: CanvasRenderingContext2D, view: View, trail: TrailPoint[], colour: string): void {
  if (trail.length < 2) return;
  const stride = Math.max(1, Math.floor(trail.length / MAX_TRAIL_DRAWN));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = stride; i < trail.length; i += stride) {
    const from = trail[i - stride];
    const to = trail[i];
    const a = toPixel(view, from.x, from.y);
    const b = toPixel(view, to.x, to.y);
    const share = i / trail.length;
    ctx.strokeStyle = colour;
    ctx.globalAlpha = 0.1 + 0.55 * share;
    ctx.lineWidth = 1.2 + 1.6 * share;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, body: SceneBody, position: AnalyticalBody, view: View, index: number): void {
  const centre = toPixel(view, position.x, position.y);
  ctx.save();
  ctx.translate(centre.x, centre.y);
  // The world y axis points up while the canvas y axis points down, so a positive
  // world angle is a negative screen rotation.
  ctx.rotate((-position.angleDeg * Math.PI) / 180);
  ctx.beginPath();
  if (body.kind === "ball") {
    ctx.arc(0, 0, Math.max(1.5, body.radius * view.k), 0, Math.PI * 2);
    chalkShape(ctx, bodyFill(body, index));
  } else if (body.kind === "ramp") {
    const [a, b, c] = rampVertices(body).map((vertex) => toPixel(view, vertex.x, vertex.y));
    ctx.moveTo(a.x - centre.x, a.y - centre.y);
    ctx.lineTo(b.x - centre.x, b.y - centre.y);
    ctx.lineTo(c.x - centre.x, c.y - centre.y);
    ctx.closePath();
    chalkShape(ctx, bodyFill(body, index));
  } else {
    const half = (body.width * view.k) / 2;
    const tall = (body.height * view.k) / 2;
    roundRect(ctx, -half, -tall, half * 2, tall * 2, Math.min(4, half, tall));
    chalkShape(ctx, bodyFill(body, index));
  }
  ctx.restore();
}

function drawConstraints(ctx: CanvasRenderingContext2D, scene: Scene, view: View, frame: AnalyticalFrame): void {
  if (scene.constraints.length === 0) return;
  const byId = new Map(frame.bodies.map((entry) => [entry.id, entry]));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const link of scene.constraints) {
    const host = byId.get(link.bodyA) ?? { x: link.anchor.x, y: link.anchor.y };
    const a = toPixel(view, link.anchor.x, link.anchor.y);
    const b = toPixel(view, host.x, host.y);
    ctx.strokeStyle = "rgba(242, 247, 241, 0.7)";
    if (link.kind === "spring") {
      const coils = 9;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const nx = -uy;
      const ny = ux;
      const amp = Math.min(13, Math.max(5, length * 0.09));
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      for (let index = 1; index <= coils; index += 1) {
        const along = (index / coils) * length;
        const side = index === 1 || index === coils ? 0 : index % 2 === 0 ? amp : -amp;
        ctx.lineTo(a.x + ux * along + nx * side, a.y + uy * along + ny * side);
      }
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = CHALK;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// The force vector arrives as newtons in the x and y components with the
// magnitude stated for the label. The fallback direction only matters if a
// scene reports a zero component pair with a non zero magnitude.
function forceDirection(force: AnalyticalForce, scene: Scene, body: SceneBody | undefined): Point {
  if (Math.hypot(force.x, force.y) > 1e-9) return { x: force.x, y: force.y };
  const ramp = scene.bodies.find((item) => item.kind === "ramp");
  const frame = ramp && body ? rampFrame(ramp) : null;
  const onRamp =
    frame !== null &&
    body !== undefined &&
    Math.abs((((body.angleDeg - frame.angleDeg + 540) % 360) - 180)) < 1;
  switch (force.kind) {
    case "gravity":
      return { x: 0, y: -1 };
    case "normal":
      return onRamp && frame ? frame.outward : { x: 0, y: 1 };
    case "friction":
      return onRamp && frame ? frame.downhill : { x: 1, y: 0 };
    case "spring": {
      const host = scene.bodies.find((item) => item.id === force.bodyId);
      const link = scene.constraints.find((item) => item.kind === "spring" && item.bodyA === force.bodyId);
      if (!host || !link) return { x: 0, y: 1 };
      const dx = link.anchor.x - host.x;
      const dy = link.anchor.y - host.y;
      const length = Math.hypot(dx, dy) || 1;
      return { x: dx / length, y: dy / length };
    }
    default:
      return { x: 1, y: 0 };
  }
}

function drawForces(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  frame: AnalyticalFrame,
  view: View,
  bounds: Bounds,
  bodyById: Map<string, SceneBody>,
): void {
  if (frame.forces.length === 0) return;
  const peak = frame.forces.reduce((best, force) => Math.max(best, Math.abs(force.magnitude)), 0);
  if (peak <= 0) return;
  const perNewton = ARROW_PEAK_PX / peak;
  const perBody = new Map<string, number>();

  ctx.save();
  ctx.lineCap = "round";
  frame.forces.forEach((force) => {
    const body = bodyById.get(force.bodyId);
    const entry = frame.bodies.find((item) => item.id === force.bodyId);
    if (!entry) return;
    const magnitude = Math.abs(force.magnitude);
    if (magnitude <= 0) return;
    const direction = forceDirection(force, scene, body);
    const length = Math.hypot(direction.x, direction.y) || 1;
    const ux = direction.x / length;
    const uy = direction.y / length;
    const colour = FORCE_COLOUR[force.kind] ?? CHALK;
    const anchor = toPixel(view, entry.x, entry.y);
    const support = body ? bodySupport(body) * view.k : 6;
    const startX = anchor.x + ux * (support * 0.55 + 2);
    const startY = anchor.y - uy * (support * 0.55 + 2);
    const arrow = clamp(magnitude * perNewton, ARROW_MIN_PX, ARROW_MAX_PX);
    const tipX = startX + ux * arrow;
    const tipY = startY - uy * arrow;

    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    const head = Math.min(10, arrow * 0.42);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * head - uy * head * 0.55, tipY + uy * head - ux * head * 0.55);
    ctx.lineTo(tipX - ux * head + uy * head * 0.55, tipY + uy * head + ux * head * 0.55);
    ctx.closePath();
    ctx.fill();

    // Stagger the chips so two forces on the same body never sit on top of each other.
    const slot = perBody.get(force.bodyId) ?? 0;
    perBody.set(force.bodyId, slot + 1);
    const offset = 16 + slot * 18;
    paintChip(ctx, `${force.kind} ${magnitude.toFixed(1)} N`, tipX + ux * 6 - uy * offset, tipY - uy * 6 + ux * offset, bounds, colour);
  });
  ctx.restore();
}

function drawBodyLabels(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  frame: AnalyticalFrame,
  view: View,
  bounds: Bounds,
  bodyById: Map<string, SceneBody>,
): void {
  for (const entry of frame.bodies) {
    const body = bodyById.get(entry.id);
    if (!body || !body.label) continue;
    const point = toPixel(view, entry.x, entry.y);
    const support = bodySupport(body) * view.k;
    paintChip(ctx, body.label, point.x, point.y - support - 15, bounds, CHALK);
  }
}

// A cropped picture from the uploaded drawing is drawn on top of the chalk shape
// it replaces. The shape is always painted first so a slow, missing or failed
// crop still leaves a readable diagram behind. Rects are never stretched around
// a rotated body: a ball keeps its circular footprint, a block keeps its own
// width and height, and a ramp is anchored on its lower left corner because that
// is where scene.world places it, with the picture reaching upward.
function drawSprites(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  frame: AnalyticalFrame,
  view: View,
  images: Map<string, HTMLImageElement>,
): void {
  const bodyById = new Map(scene.bodies.map((body) => [body.id, body]));
  for (const entry of frame.bodies) {
    const image = images.get(entry.id);
    const body = bodyById.get(entry.id);
    if (!image || !body || !image.complete || image.naturalWidth === 0) continue;
    ctx.save();
    if (body.kind === "ramp") {
      const corner = toPixel(view, body.x, body.y);
      const w = body.width * view.k;
      const h = body.height * view.k;
      ctx.drawImage(image, corner.x, corner.y - h, w, h);
    } else {
      const isBall = body.kind === "ball";
      const w = (isBall ? body.radius * 2 : body.width) * view.k;
      const h = (isBall ? body.radius * 2 : body.height) * view.k;
      const centre = toPixel(view, entry.x, entry.y);
      ctx.translate(centre.x, centre.y);
      ctx.rotate((-entry.angleDeg * Math.PI) / 180);
      ctx.drawImage(image, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }
}

function drawDiagram(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  frame: AnalyticalFrame,
  view: View,
  options: PaintOptions,
  sprites: Map<string, HTMLImageElement>,
): void {
  const bounds: Bounds = { left: 4, top: 4, right: options.width - 4, bottom: options.height - 4 };
  ctx.clearRect(0, 0, options.width, options.height);
  drawGrid(ctx, scene, view);

  const bodyById = new Map(scene.bodies.map((body) => [body.id, body]));
  const questionId = scene.question.bodyId;

  drawStatic(ctx, scene, view);
  const track = frame.bodies.find((entry) => entry.id === questionId);
  drawTrail(ctx, view, options.trail, track && bodyById.get(questionId)?.kind === "ball" ? PEACH : MINT);

  scene.bodies.forEach((body, index) => {
    if (body.isStatic) return;
    const entry = frame.bodies.find((item) => item.id === body.id);
    if (entry) drawBody(ctx, body, entry, view, index);
  });

  drawSprites(ctx, scene, frame, view, sprites);
  drawConstraints(ctx, scene, view, frame);
  if (options.overlays) drawForces(ctx, scene, frame, view, bounds, bodyById);
  drawBodyLabels(ctx, scene, frame, view, bounds, bodyById);
}

// A frame with no engine data still has to draw something sensible, so the scene
// layout itself stands in until the engine is happy.
function fallbackFrame(scene: Scene, time: number): AnalyticalFrame {
  return {
    scene,
    time,
    duration: 0,
    finished: false,
    bodies: scene.bodies.map((body) => ({ id: body.id, x: body.x, y: body.y, angleDeg: body.angleDeg })),
    forces: [],
    energy: { kinetic: 0, potential: 0, dissipated: 0 },
    metrics: { distance: 0, finalSpeed: 0, time, maxHeight: 0, range: 0, period: null },
    assumptions: [],
  };
}

function safeDuration(scene: Scene): number {
  try {
    const duration = getDuration(scene);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

function safeSample(scene: Scene, time: number): AnalyticalFrame {
  try {
    return sampleScene(scene, time);
  } catch {
    return fallbackFrame(scene, time);
  }
}

export default function SimulationCanvas({
  scene,
  playing,
  resetKey,
  showOverlays,
  sprites,
  onFrame,
  onComplete,
}: SimulationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene>(scene);
  const overlaysRef = useRef<boolean>(showOverlays);
  const onFrameRef = useRef(onFrame);
  const onCompleteRef = useRef(onComplete);
  const frameRef = useRef<AnalyticalFrame>(fallbackFrame(scene, 0));
  const timeRef = useRef(0);
  const durationRef = useRef(0);
  const trailRef = useRef<TrailPoint[]>([]);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const lastNowRef = useRef(0);
  const lastReportRef = useRef(0);
  const doneRef = useRef(false);
  const tokenRef = useRef<{ scene: Scene; resetKey: number } | null>(null);
  const spriteImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const spriteTokenRef = useRef(0);

  const description = useMemo(() => {
    const parts = scene.bodies.filter((body) => body.label).map((body) => body.label);
    const subject = parts.length > 0 ? parts.join(", ") : `a ${scene.problemType} scene`;
    return `Chalkboard diagram of ${subject}. The same measurements are written out as text below the diagram.`;
  }, [scene]);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    overlaysRef.current = showOverlays;
  }, [showOverlays]);

  // Callbacks are held in refs so an inline arrow in the parent never restarts
  // the animation loop.
  useEffect(() => {
    onFrameRef.current = onFrame;
    onCompleteRef.current = onComplete;
  }, [onFrame, onComplete]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    if (width <= 1 || height <= 1) return;
    const sceneNow = sceneRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawDiagram(ctx, sceneNow, frameRef.current, makeView(sceneNow, width, height), {
      width,
      height,
      overlays: overlaysRef.current,
      trail: trailRef.current,
    }, spriteImagesRef.current);
  }, []);

  // Crops arrive as local data URLs. Each one is decoded off the main thread by
  // the browser, then the board is repainted so a paused diagram picks the
  // picture up as soon as it is ready. A load that finishes after the scene moved
  // on is dropped, so a stale crop can never be drawn over the new board.
  useEffect(() => {
    const token = spriteTokenRef.current + 1;
    spriteTokenRef.current = token;
    const previous = spriteImagesRef.current;
    const next = new Map<string, HTMLImageElement>();
    for (const [id, source] of Object.entries(sprites ?? {})) {
      if (typeof source !== "string" || source.length === 0) continue;
      const cached = previous.get(id);
      if (cached && cached.src === source) {
        next.set(id, cached);
        continue;
      }
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        if (spriteTokenRef.current !== token) return;
        spriteImagesRef.current.set(id, image);
        paint();
      };
      image.onerror = () => {
        if (spriteTokenRef.current !== token) return;
        spriteImagesRef.current.delete(id);
      };
      image.src = source;
    }
    spriteImagesRef.current = next;
    paint();
    return () => {
      if (spriteTokenRef.current === token) spriteTokenRef.current += 1;
    };
  }, [sprites, paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      sizeRef.current = { width: Math.round(rect.width), height: Math.round(rect.height), dpr };
      const backingWidth = Math.max(1, Math.round(rect.width * dpr));
      const backingHeight = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      paint();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    const zoom = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    zoom.addEventListener("change", measure);
    measure();
    return () => {
      observer.disconnect();
      zoom.removeEventListener("change", measure);
    };
  }, [paint]);

  useEffect(() => {
    if (tokenRef.current?.scene !== scene || tokenRef.current?.resetKey !== resetKey) {
      tokenRef.current = { scene, resetKey };
      timeRef.current = 0;
      trailRef.current = [];
      doneRef.current = false;
      lastReportRef.current = 0;
      durationRef.current = safeDuration(scene);
      const first = safeSample(scene, 0);
      frameRef.current = first;
      const tracked = first.bodies.find((entry) => entry.id === scene.question.bodyId);
      trailRef.current = tracked ? [{ x: tracked.x, y: tracked.y, t: 0 }] : [];
      onFrameRef.current?.(first);
    }

    let raf = 0;

    const tick = (now: number): void => {
      const previous = lastNowRef.current;
      lastNowRef.current = now;
      if (previous === 0) {
        paint();
        raf = requestAnimationFrame(tick);
        return;
      }
      const gap = (now - previous) / 1000;
      // A gap longer than a hidden tab or a stalled frame is dropped rather than
      // credited, and a long frame is capped, so simulated time never jumps.
      const advance = gap > HIDDEN_GAP_SECONDS ? 0 : clamp(gap, 0, MAX_FRAME_SECONDS);
      const duration = durationRef.current;
      const time = duration > 0 ? Math.min(duration, timeRef.current + advance) : 0;
      timeRef.current = time;
      const frame = safeSample(scene, time);
      frameRef.current = frame;
      const tracked = frame.bodies.find((entry) => entry.id === scene.question.bodyId);
      if (tracked) {
        const trail = trailRef.current;
        const last = trail[trail.length - 1];
        if (!last || time - last.t >= TRAIL_STEP_SECONDS) {
          trail.push({ x: tracked.x, y: tracked.y, t: time });
          if (trail.length > MAX_TRAIL_POINTS) trail.splice(0, trail.length - MAX_TRAIL_POINTS);
        }
      }
      paint();
      if (now - lastReportRef.current >= REPORT_INTERVAL_MS) {
        lastReportRef.current = now;
        onFrameRef.current?.(frame);
      }
      if (duration > 0 && time >= duration && !doneRef.current) {
        doneRef.current = true;
        onFrameRef.current?.(frame);
        onCompleteRef.current?.();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = (): void => {
      if (document.hidden) lastNowRef.current = 0;
    };

    lastNowRef.current = 0;
    document.addEventListener("visibilitychange", onVisibility);
    if (playing) {
      raf = requestAnimationFrame(tick);
    } else {
      // Paused, reset and finished states all settle on one exact report.
      onFrameRef.current?.(frameRef.current);
    }
    paint();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [scene, resetKey, playing, showOverlays, paint]);

  return <canvas ref={canvasRef} data-chalk-simulation="" role="img" aria-label={description} />;
}
