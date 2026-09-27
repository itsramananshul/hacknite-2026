import test from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";

import { getDuration, sampleScene, solveScene } from "../lib/engine";
import { bodySupport, inclineSetup, rampFrame, rampSurfacePoint, toRadians } from "../lib/geometry";
import { inclinePreset, projectilePreset, springPreset } from "../lib/presets";
import { resolveScene, validateScene, type Scene } from "../lib/schema";

test("spring preserves an upward initial velocity and its energy", () => {
  const moving = structuredClone(springPreset);
  moving.bodies.find((body) => body.id === moving.question.bodyId)!.initialVelocity.y = 2;
  const initial = sampleScene(moving, 0);
  const next = sampleScene(moving, 0.00001);
  const initialBody = initial.bodies.find((body) => body.id === moving.question.bodyId)!;
  const nextBody = next.bodies.find((body) => body.id === moving.question.bodyId)!;
  assert.ok(nextBody.y > initialBody.y, "positive y velocity moves the mass upward");
  assert.ok(Math.abs((nextBody.y - initialBody.y) / 0.00001 - 2) < 0.001);
  for (const time of [0.1, 0.4, 0.9]) {
    const frame = sampleScene(moving, time);
    assert.ok(Math.abs(frame.energy.kinetic + frame.energy.potential - initial.energy.kinetic - initial.energy.potential) < 1e-8);
  }
});

// Independent reference numbers, derived by hand rather than read back from the
// engine. Every expectation below is written out from the physics.
const G = 9.81;
const SIN30 = 0.5;
const COS30 = Math.sqrt(3) / 2;
const INCLINE_A = G * (SIN30 - 0.2 * COS30);
const INCLINE_S = 0.5 * INCLINE_A * 4;
const LAUNCH_V = 7.0710678118654755;
const SPRING_PERIOD = 2 * Math.PI * Math.sqrt(1 / 20);
const close = (actual: number, expected: number, tolerance = 1e-9, message = ""): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${message} expected ${expected}, got ${actual}`,
  );
};

const scene = (overrides: Partial<Scene> & Pick<Scene, "problemType">): Scene =>
  resolveScene({
    units: { length: "m", mass: "kg", angle: "deg" },
    world: { gravity: G, pixelsPerMeter: 50, width: 20, height: 12 },
    bodies: [],
    constraints: [],
    labeledValues: [],
    confidence: 1,
    notes: "",
    ...overrides,
  }).scene;

const boxOnRamp = (friction: number, window = 2) => {
  const run = 10;
  const rise = run * Math.tan(toRadians(30));
  const frame = rampFrame({ id: "ramp", kind: "ramp", x: 1, y: 1, width: run, height: rise, angleDeg: 30, radius: 0.25, mass: 1, isStatic: true, friction: 0, restitution: 0, initialVelocity: { x: 0, y: 0 }, label: "" } as never);
  const start = rampSurfacePoint({ x: 1, y: 1, width: run, height: rise, angleDeg: 30 } as never, 10);
  return scene({
    problemType: "incline",
    bodies: [
      { id: "ramp", kind: "ramp", x: 1, y: 1, width: run, height: rise, angleDeg: 30, radius: 0.25, mass: 1, isStatic: true, friction: 0, restitution: 0, initialVelocity: { x: 0, y: 0 }, label: "" },
      { id: "box", kind: "block", x: start.x + frame.outward.x * 0.35, y: start.y + frame.outward.y * 0.35, width: 0.7, height: 0.7, angleDeg: 30, radius: 0.25, mass: 5, isStatic: false, friction, restitution: 0, initialVelocity: { x: 0, y: 0 }, label: "" },
    ],
    question: { text: "How far?", target: "distance", bodyId: "box", timeWindow: window },
  });
};

test("incline preset matches the hand calculated answer", () => {
  const result = solveScene(inclinePreset);
  assert.ok(result);
  assert.equal(result.unit, "m");
  close(result.value, INCLINE_S, 1e-6, "distance");
  close(result.value, 6.41171631555, 1e-5, "published distance");
  close(result.finalSpeed, INCLINE_A * 2, 1e-5, "speed after 2 s");
  close(result.time, 2, 1e-9, "window");
  const frame = sampleScene(inclinePreset, 2);
  assert.equal(frame.finished, true);
  close(frame.duration, 2, 1e-12, "duration");
  close(frame.metrics.distance, INCLINE_S, 1e-9, "frame distance");
  close(frame.metrics.finalSpeed, 2 * INCLINE_A, 1e-9, "frame speed");
});

test("static friction with mu = 0.8 holds the box at rest", () => {
  const stuck = boxOnRamp(0.8);
  const result = solveScene(stuck);
  assert.ok(result);
  assert.equal(result.value, 0);
  assert.equal(result.finalSpeed, 0);
  assert.ok(result.assumptions.join(" ").includes("never starts"));
  const frame = sampleScene(stuck, 2);
  assert.equal(frame.metrics.distance, 0);
  assert.equal(frame.metrics.finalSpeed, 0);
  const box = frame.bodies.find((item) => item.id === "box");
  const start = frame.bodies.find((item) => item.id === "ramp");
  assert.ok(box && start);
  // Not one micron of travel, and the tangential forces cancel exactly.
  const gravity = frame.forces.find((item) => item.kind === "gravity");
  const friction = frame.forces.find((item) => item.kind === "friction");
  assert.equal(gravity?.magnitude, 5 * G);
  close(friction?.magnitude ?? 0, 5 * G * SIN30, 1e-9, "static friction balances gravity along the slope");
  close(friction?.y ?? 0, 5 * G * SIN30 * SIN30, 1e-9, "friction points uphill");
  close(friction?.x ?? 0, 5 * G * SIN30 * COS30, 1e-9, "friction points uphill in x");
});

test("a window longer than the ramp is capped at the foot of the ramp", () => {
  const short = boxOnRamp(0.2, 4);
  const result = solveScene(short);
  assert.ok(result);
  // 10 m of ramp below the box, reached after sqrt(2 * 10 / a).
  const endTime = Math.sqrt(2 * 10 / INCLINE_A);
  close(getDuration(short), endTime, 1e-9, "duration is the ramp end");
  close(result.value, 10, 1e-6, "distance is the length of the ramp");
  close(result.time, endTime, 1e-6, "time to the foot");
  assert.ok(result.assumptions.join(" ").includes("foot of the ramp"));
  assert.ok(result.assumptions.join(" ").includes("25.6"), "the endless ramp figure is reported");
  const end = sampleScene(short, endTime);
  close(end.metrics.distance, 10, 1e-6, "the animation stops on the ramp");
  assert.equal(end.finished, true);
});

test("instantaneous force arrows on the ramp are correct", () => {
  const frame = sampleScene(inclinePreset, 0);
  const normal = frame.forces.find((item) => item.kind === "normal");
  const friction = frame.forces.find((item) => item.kind === "friction");
  const gravity = frame.forces.find((item) => item.kind === "gravity");
  const expectedNormal = 5 * G * COS30;
  close(normal?.magnitude ?? 0, expectedNormal, 1e-9, "N = m g cos30");
  close(normal?.x ?? 0, expectedNormal * -SIN30, 1e-9, "normal points along the outward normal");
  close(normal?.y ?? 0, expectedNormal * COS30, 1e-9, "normal is tilted with the slope");
  close(friction?.magnitude ?? 0, 0.2 * expectedNormal, 1e-9, "friction = mu N");
  close(friction?.x ?? 0, 0.2 * expectedNormal * COS30, 1e-9, "friction points uphill");
  close(gravity?.magnitude ?? 0, 5 * G, 1e-12, "weight");
  close(gravity?.y ?? 0, -5 * G, 1e-12, "weight points down");
  // Tangential balance reproduces the acceleration the solver reports.
  const setup = inclineSetup(resolveScene(inclinePreset).scene, resolveScene(inclinePreset).scene.bodies[1], resolveScene(inclinePreset).scene.bodies[0]);
  close(setup.acceleration, INCLINE_A, 1e-9, "net acceleration");
});

test("energy balances along the ramp", () => {
  const start = sampleScene(inclinePreset, 0);
  const middle = sampleScene(inclinePreset, 1.3);
  const total = (frame: typeof start): number => frame.energy.kinetic + frame.energy.potential + frame.energy.dissipated;
  // The foot of the ramp is the zero of the potential, and the ramp sits at y = 1.
  const initial = 5 * G * (start.bodies[1].y - 0.35 - 1);
  close(total(start), initial, 1e-9, "kinetic + potential + dissipated at t = 0");
  close(total(middle), initial, 1e-9, "the same total halfway through");
  const slid = middle.metrics.distance - start.metrics.distance;
  close(middle.energy.dissipated, 0.2 * 5 * G * COS30 * slid, 1e-9, "friction loss is mu N s");
  close(middle.energy.kinetic, 0.5 * 5 * middle.metrics.finalSpeed ** 2, 1e-12, "kinetic is half m v squared");
});

test("projectile preset matches the hand calculated answer", () => {
  const result = solveScene(projectilePreset);
  assert.ok(result);
  const flight = 2 * LAUNCH_V / G;
  close(result.time, flight, 1e-6, "flight time");
  close(result.value, LAUNCH_V * flight, 1e-6, "range");
  close(result.value, 10.19368, 1e-6, "published range");
  close(result.maxHeight ?? 0, (LAUNCH_V * LAUNCH_V) / (2 * G), 1e-6, "peak height");
  close(getDuration(projectilePreset), flight, 1e-9, "duration is the landing time");
  const end = sampleScene(projectilePreset, flight);
  close(end.metrics.range, 10.19368, 1e-6, "frame range");
  close(end.metrics.maxHeight, (LAUNCH_V * LAUNCH_V) / (2 * G), 1e-9, "frame peak");
  assert.equal(end.finished, true);
});

test("a downward launch from an elevated ground lands on the positive root", () => {
  const dropped = scene({
    problemType: "freefall",
    bodies: [
      { id: "ground", kind: "ground", x: 10, y: 0.25, width: 20, height: 0.5, radius: 0.25, angleDeg: 0, mass: 1, isStatic: true, friction: 0, restitution: 0, initialVelocity: { x: 0, y: 0 }, label: "" },
      { id: "ball", kind: "ball", x: 4, y: 5.25, width: 0.7, height: 0.7, radius: 0.25, angleDeg: 0, mass: 2, isStatic: false, friction: 0, restitution: 0, initialVelocity: { x: 3, y: -4 }, label: "" },
    ],
    question: { text: "When does it land?", target: "time", bodyId: "ball", timeWindow: 5 },
  });
  const result = solveScene(dropped);
  assert.ok(result);
  // 4.5 m of fall from a downward 4 m/s: 4.5 = -4t + ½gt².
  const expected = (-4 + Math.sqrt(16 + 2 * G * 4.5)) / G;
  close(result.value, expected, 1e-5, "landing time");
  close(getDuration(dropped), expected, 1e-9, "duration is the landing time");
  const end = sampleScene(dropped, expected);
  close(end.metrics.maxHeight, 4.5, 1e-9, "a downward launch never rises above where it started");
  const ballEnd = end.bodies.find((item) => item.id === "ball");
  assert.ok(ballEnd);
  close(ballEnd.y - 0.25, 0.5, 1e-9, "the bottom of the ball meets the top of the ground");
  assert.equal(end.finished, true);
});

test("energy balances in flight", () => {
  const start = sampleScene(projectilePreset, 0);
  const later = sampleScene(projectilePreset, 0.7);
  const total = (frame: typeof start): number => frame.energy.kinetic + frame.energy.potential;
  close(total(start), 0.5 * 1 * 100, 1e-9, "launch energy");
  close(total(later), 0.5 * 1 * 100, 1e-9, "the same energy in flight");
  close(start.energy.dissipated, 0, 1e-12, "no drag means no loss");
});

test("a constant applied force changes the acceleration correctly", () => {
  const push = 10;
  const pushed = scene({
    problemType: "freefall",
    appliedForces: [{ bodyId: "ball", x: 0, y: push }],
    bodies: [
      { id: "ground", kind: "ground", x: 10, y: 0.25, width: 20, height: 0.5, radius: 0.25, angleDeg: 0, mass: 1, isStatic: true, friction: 0, restitution: 0, initialVelocity: { x: 0, y: 0 }, label: "" },
      { id: "ball", kind: "ball", x: 4, y: 5.25, width: 0.7, height: 0.7, radius: 0.25, angleDeg: 0, mass: 2, isStatic: false, friction: 0, restitution: 0, initialVelocity: { x: 0, y: 0 }, label: "" },
    ],
    question: { text: "When does it land?", target: "time", bodyId: "ball", timeWindow: 5 },
  });
  const net = G - push / 2;
  const expected = Math.sqrt(2 * 4.5 / net);
  const result = solveScene(pushed);
  assert.ok(result);
  close(result.value, expected, 1e-5, "landing time with an upward push");
  const applied = sampleScene(pushed, 0).forces.find((item) => item.kind === "applied");
  close(applied?.magnitude ?? 0, push, 1e-12, "the push is reported");
});

test("spring period, amplitude and energy are correct", () => {
  const result = solveScene(springPreset);
  assert.ok(result);
  close(result.value, SPRING_PERIOD, 1e-5, "2 pi sqrt(m/k)");
  close(result.value, 1.404962946, 1e-6, "published period");
  close(result.period ?? 0, SPRING_PERIOD, 1e-5, "period field");
  // rest length 3 m, sag m g/k = 0.4905 m, started 4 m below the anchor.
  close(result.amplitude ?? 0, 4 - (3 + G / 20), 1e-5, "amplitude is the initial stretch");
  assert.equal(getDuration(springPreset), 8);

  const total = (time: number): number => {
    const frame = sampleScene(springPreset, time);
    return frame.energy.kinetic + frame.energy.potential;
  };
  const initialEnergy = total(0);
  assert.ok(initialEnergy > 40, "the total energy is dominated by the height above the floor");
  for (const time of [0.13, 0.5, 1, SPRING_PERIOD / 2, SPRING_PERIOD, SPRING_PERIOD * 2]) {
    close(total(time), initialEnergy, 1e-9, `energy after ${time.toFixed(3)} s`);
  }
  // Half a period later the mass is at the other end of its swing, which is
  // above equilibrium because it started hanging below it.
  const flipped = sampleScene(springPreset, SPRING_PERIOD / 2);
  const rest = sampleScene(springPreset, 0);
  const ball = (frame: typeof flipped): number => frame.bodies[0].y;
  close(ball(flipped) - ball(rest), 2 * (4 - (3 + G / 20)), 1e-9, "half a period flips the stretch");
  assert.equal(flipped.metrics.period, SPRING_PERIOD);
});

test("a spring held at its rest length only sags by mg/k", () => {
  const hanging = scene({
    problemType: "spring",
    constraints: [{ id: "spring", kind: "spring", bodyA: "mass", bodyB: null, anchor: { x: 6, y: 8 }, stiffness: 50, restLength: 3 }],
    bodies: [{ id: "mass", kind: "ball", x: 6, y: 5, width: 0.7, height: 0.7, radius: 0.25, angleDeg: 0, mass: 2, isStatic: false, friction: 0, restitution: 0, initialVelocity: { x: 0, y: 0 }, label: "" }],
    question: { text: "Period?", target: "period", bodyId: "mass", timeWindow: 4 },
  });
  const result = solveScene(hanging);
  assert.ok(result);
  close(result.value, 2 * Math.PI * Math.sqrt(2 / 50), 1e-5, "period of a 2 kg mass on 50 N/m");
  // Released at the rest length, so the amplitude is the static sag.
  close(result.amplitude ?? 0, (2 * G) / 50, 1e-5, "amplitude equals the sag");
  // It falls to the equilibrium point a quarter of a period later.
  const quarter = sampleScene(hanging, result.value / 4);
  const start = sampleScene(hanging, 0);
  close(quarter.bodies[0].y - start.bodies[0].y, -(2 * G) / 50, 1e-5, "a quarter period reaches equilibrium");
  close(quarter.metrics.finalSpeed, ((2 * G) / 50) * Math.sqrt(50 / 2), 1e-5, "fastest speed at equilibrium");
});

test("bounding boxes are accepted only inside the unit square", () => {
  const withBox = (box: unknown): Scene => ({
    ...projectilePreset,
    bodies: projectilePreset.bodies.map((item) => (item.id === "ball" ? { ...item, boundingBox: box } : item)),
  }) as Scene;
  const valid = validateScene(withBox({ x: 0.1, y: 0.2, width: 0.5, height: 0.25 }));
  close(valid.bodies[1].boundingBox?.x ?? 0, 0.1, 1e-12, "the box survives validation");
  for (const bad of [{ x: -0.1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1.2, height: 1 }, { x: 0, y: 0, width: 1, height: -1 }]) {
    assert.throws(() => validateScene(withBox(bad)), ZodError, `rejected ${JSON.stringify(bad)}`);
  }
});

test("labels override the visual estimates on the body", () => {
  const estimated = {
    ...projectilePreset,
    labeledValues: [...projectilePreset.labeledValues, { symbol: "m", value: 1, unit: "kg", appliesTo: "ball", field: "mass" as const }],
    bodies: projectilePreset.bodies.map((item) =>
      item.id === "ball" ? { ...item, mass: 9, friction: 0.9, initialVelocity: { x: 2, y: 0.5 } } : item,
    ),
  } as Scene;
  const { scene: resolved, labels } = resolveScene(estimated);
  const ball = resolved.bodies.find((item) => item.id === "ball");
  assert.ok(ball);
  assert.equal(ball.mass, 1, "the mass label wins");
  assert.equal(ball.friction, 0.9, "an unlabelled estimate survives untouched");
  close(Math.hypot(ball.initialVelocity.x, ball.initialVelocity.y), 10, 1e-9, "the speed label wins");
  const angle = labels.find((item) => item.field === "launchAngleDeg");
  const speed = labels.find((item) => item.field === "speed");
  assert.equal(angle?.display, "45.00 deg", "the launch angle shows 45 degrees, not the launch speed");
  assert.equal(speed?.display, "10.000 m/s");
});

test("resolving the same scene twice gives the same result", () => {
  const once = resolveScene(inclinePreset).scene;
  const twice = resolveScene(once).scene;
  assert.deepEqual(twice, once);
  assert.deepEqual(resolveScene(twice).scene, once, "and stays stable a third time");
  const again = resolveScene(projectilePreset).scene;
  assert.deepEqual(resolveScene(again).scene, again);
});

test("invalid references and NaN are rejected", () => {
  // These are all built raw, because the point is that validation refuses them.
  const raw = (bodies: unknown, overrides: Partial<Scene> = {}): unknown => ({
    units: { length: "m", mass: "kg", angle: "deg" },
    world: { gravity: G, pixelsPerMeter: 50, width: 20, height: 12 },
    bodies,
    constraints: [],
    labeledValues: [],
    confidence: 1,
    notes: "",
    problemType: "incline",
    question: { text: "", target: "distance", bodyId: "box", timeWindow: 2 },
    ...overrides,
  });
  const bodies = inclinePreset.bodies;
  assert.throws(() => validateScene(raw([bodies[0], bodies[0]])), ZodError, "duplicate body ids");
  assert.throws(
    () => validateScene(raw(bodies, { question: { text: "", target: "distance", bodyId: "ghost", timeWindow: 2 } })),
    ZodError,
    "the question body has to exist",
  );
  assert.throws(
    () => validateScene(raw(bodies, { appliedForces: [{ bodyId: "box", x: Number.NaN, y: 0 }] })),
    ZodError,
    "NaN is not a force",
  );
  assert.throws(
    () => validateScene(raw(bodies, { appliedForces: [{ bodyId: "ramp", x: 0, y: 0 }] })),
    ZodError,
    "a static body cannot be pushed",
  );
  assert.throws(
    () => validateScene(raw(bodies.map((item) => (item.id === "ramp" ? { ...item, height: 9 } : item)))),
    ZodError,
    "the ramp height has to match the slope",
  );
  assert.throws(
    () => validateScene(raw(bodies, { labeledValues: [{ symbol: "m", value: 5, unit: "kg", appliesTo: "ghost", field: "mass" }] })),
    ZodError,
    "labels have to point at a real body",
  );
});

test("unsupported setups are refused instead of answered with zero", () => {
  const uphill = boxOnRamp(0.2);
  const fast = scene({
    ...uphill,
    bodies: uphill.bodies.map((item) => (item.id === "box" ? { ...item, initialVelocity: { x: 3, y: 3 } } : item)),
  });
  assert.throws(() => sampleScene(fast, 1), /up the slope/);

  const twoBodies = scene({
    ...uphill,
    bodies: [...uphill.bodies, { ...uphill.bodies[1], id: "other" }],
  });
  assert.throws(() => sampleScene(twoBodies, 1), /one moving body/);

  const rope = scene({ ...uphill, constraints: [{ id: "rope", kind: "rope", bodyA: "box", bodyB: null, anchor: { x: 0, y: 8 }, stiffness: 0.5, restLength: 2 }] });
  assert.throws(() => sampleScene(rope, 1), /constraint/);

  // A strong lift from an elevated start means the body never comes back down.
  const flyingForever = scene({
    problemType: "projectile",
    appliedForces: [{ bodyId: "ball", x: 0, y: 60 }],
    bodies: projectilePreset.bodies.map((item) => (item.id === "ball" ? { ...item, x: 4, y: 5.25 } : item)),
    question: { text: "", target: "time", bodyId: "ball", timeWindow: 5 },
  });
  assert.throws(() => solveScene(flyingForever), /never returns/);
  assert.throws(() => sampleScene(flyingForever, 1), /never returns/);

  const offTheEdge = scene({
    problemType: "projectile",
    bodies: projectilePreset.bodies.map((item) => (item.id === "ground" ? { ...item, x: 2, width: 4 } : item)),
    question: { text: "", target: "range", bodyId: "ball", timeWindow: 3 },
  });
  assert.throws(() => solveScene(offTheEdge), /past the end of the ground/);

  const unknown = scene({ ...uphill, problemType: "unknown" });
  assert.throws(() => sampleScene(unknown, 1), /unknown/);
  assert.equal(solveScene(unknown), null, "and there is simply no answer to show");
});

test("a horizontal spring and a two body spring are refused", () => {
  const sideways = scene({
    problemType: "spring",
    constraints: [{ id: "spring", kind: "spring", bodyA: "mass", bodyB: null, anchor: { x: 12, y: 9 }, stiffness: 20, restLength: 3 }],
    bodies: springPreset.bodies,
    question: { text: "", target: "period", bodyId: "mass", timeWindow: 8 },
  });
  assert.throws(() => solveScene(sideways), /vertical spring/);
  const linked = scene({
    problemType: "spring",
    constraints: [
      { id: "spring", kind: "spring", bodyA: "mass", bodyB: null, anchor: { x: 10, y: 9 }, stiffness: 20, restLength: 3 },
      { id: "second", kind: "pin", bodyA: "mass", bodyB: null, anchor: { x: 10, y: 9 }, stiffness: 0.5, restLength: 1 },
    ],
    bodies: springPreset.bodies,
    question: { text: "", target: "period", bodyId: "mass", timeWindow: 8 },
  });
  assert.throws(() => solveScene(linked), /one spring/);
});

test("frames are clamped, ordered and consistent with the duration", () => {
  const duration = getDuration(inclinePreset);
  assert.equal(sampleScene(inclinePreset, -5).time, 0, "negative time clamps to the start");
  const past = sampleScene(inclinePreset, duration + 4);
  assert.equal(past.time, duration);
  assert.equal(past.finished, true);
  assert.equal(sampleScene(inclinePreset, duration - 0.01).finished, false);
  assert.throws(() => sampleScene(inclinePreset, Number.NaN), /finite/);
  const early = sampleScene(inclinePreset, 0.5);
  const late = sampleScene(inclinePreset, 1.5);
  assert.ok(late.metrics.distance > early.metrics.distance, "the box keeps going downhill");
  assert.ok(late.bodies.length === inclinePreset.bodies.length, "static bodies stay in the frame");
  assert.deepEqual(sampleScene(inclinePreset, 1).metrics, sampleScene(inclinePreset, 1).metrics, "sampling is repeatable");
});
