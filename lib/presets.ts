import { advancedPresets, advancedPresetList } from "./advanced-presets";
import type {
  SceneAnswer,
  SceneCamera,
  SceneConnector,
  SceneObject,
  SceneScript,
  SceneStep,
  SceneVariable,
  SceneVector,
  SceneWorld,
} from "./schema";

export type PresetKey = "projectile" | "incline" | "atwood" | "orbit" | "collision" | "fluid" | "wave" | "damping" | "circuit" | "drag";

const CHALK = "#e9e4d8";
const MINT = "#9fe3bd";
const PEACH = "#f6c8a4";
const LAVENDER = "#c9bce8";
const PIPE = "#6b7c86";
const BOARD = "#39463f";

const expr = (value: number | string): string => (typeof value === "number" ? formatNumber(value) : value);

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(10)));
}

const point = (x: number | string, y: number | string, z: number | string) => ({
  x: expr(x),
  y: expr(y),
  z: expr(z),
});

const world = (gravity: number | string): SceneWorld => ({
  gravity: expr(gravity),
  showGrid: true,
  groundY: 0,
  scale: 1,
});

const camera = (position: [number, number, number], target: [number, number, number]): SceneCamera => ({
  position,
  target,
});

const variable = (
  name: string,
  value: number,
  unit: string,
  label: string,
  adjustable: boolean,
  min: number,
  max: number,
  step: number,
): SceneVariable => ({ name, value, unit, label, adjustable, min, max, step });

const fixed = (name: string, value: number, unit: string, label: string): SceneVariable =>
  variable(name, value, unit, label, false, value, value, Math.max(Math.abs(value) / 100, 1e-6));

const object = (
  partial: Pick<SceneObject, "id" | "shape" | "position"> & Partial<SceneObject>,
): SceneObject => ({
  size: { x: 1, y: 1, z: 1, radius: 0.5 },
  color: CHALK,
  label: "",
  rotation: point(0, 0, 0),
  trail: false,
  visible: "1",
  ...partial,
});

const vector = (
  partial: Pick<SceneVector, "id" | "attachTo" | "kind" | "components"> & Partial<SceneVector>,
): SceneVector => ({
  label: "",
  color: MINT,
  visible: "1",
  ...partial,
});

const ropeConnector = (id: string, from: string, to: string): SceneConnector => ({
  id,
  kind: "rope",
  from,
  to,
});

const step = (
  partial: Pick<SceneStep, "title" | "narration" | "tStart" | "tEnd"> & Partial<SceneStep>,
): SceneStep => ({
  equations: [],
  focus: [],
  showVectors: [],
  ...partial,
});

const answer = (question: string, expression: string, value: number, unit: string): SceneAnswer => ({
  question,
  expression,
  value,
  unit,
});

const GROUND_2D = object({
  id: "ground",
  shape: "box",
  size: { x: 40, y: 0.2, z: 18, radius: 0 },
  position: point(10, -0.1, 0),
  color: BOARD,
  label: "ground",
});

const PROJECTILE_UP = "v0*sin(theta*pi/180)";
const PROJECTILE_FLIGHT = `(${PROJECTILE_UP}+sqrt((${PROJECTILE_UP})^2+2*g*h))/g`;

export const projectilePreset: SceneScript = {
  title: "Projectile off a cliff",
  problemText:
    "A ball leaves the face of a cliff at height h with speed v0 at angle theta above the horizontal. The ledge height follows h, so moving the height slider moves its top and the launch point together. Gravity pulls straight down at g, air resistance is ignored, and the ball is tracked by its centre point with a drawn radius of 0.18 m. The ball is frozen the moment it reaches the ground, so the timeline can keep running while the answer stays the true time of flight.",
  variables: [
    variable("h", 5, "m", "Launch height", true, 1, 12, 0.5),
    variable("v0", 10, "m/s", "Launch speed", true, 0, 20, 0.5),
    variable("theta", 30, "deg", "Launch angle", true, 0, 70, 1),
    fixed("g", 9.81, "m/s^2", "Gravity"),
  ],
  duration: 6,
  loop: false,
  world: world("g"),
  camera: camera([12, 8, 15], [6, 2, 0]),
  objects: [
    object({
      id: "cliff",
      shape: "box",
      size: { x: 3, y: 5, z: 6, radius: 0 },
      position: point(-1.5, "h/2", 0),
      scale: point(1, "h/5", 1),
      color: BOARD,
      label: "cliff",
    }),
    GROUND_2D,
    object({
      id: "ball",
      shape: "sphere",
      size: { x: 0.36, y: 0.36, z: 0.36, radius: 0.18 },
      position: point(
        `v0*cos(theta*pi/180)*min(t,${PROJECTILE_FLIGHT})`,
        `max(0,h+${PROJECTILE_UP}*min(t,${PROJECTILE_FLIGHT})-0.5*g*min(t,${PROJECTILE_FLIGHT})^2)`,
        0,
      ),
      color: PEACH,
      label: "ball",
      trail: true,
    }),
    object({
      id: "landingMark",
      shape: "box",
      size: { x: 0.18, y: 0.04, z: 0.7, radius: 0 },
      position: point(
        `v0*cos(theta*pi/180)*${PROJECTILE_FLIGHT}`,
        0.02,
        0,
      ),
      color: MINT,
      label: "landing point",
    }),
  ],
  connectors: [],
  vectors: [
    vector({
      id: "velocity",
      attachTo: "ball",
      kind: "velocity",
      components: point(
        `t<${PROJECTILE_FLIGHT} ? v0*cos(theta*pi/180) : 0`,
        `t<${PROJECTILE_FLIGHT} ? ${PROJECTILE_UP}-g*t : 0`,
        0,
      ),
      label: "velocity",
      color: PEACH,
      visible: `t<${PROJECTILE_FLIGHT}`,
    }),
    vector({
      id: "gravityPull",
      attachTo: "ball",
      kind: "acceleration",
      components: point(0, "-g", 0),
      label: "gravity",
      color: LAVENDER,
    }),
  ],
  steps: [
    step({
      title: "Launch",
      narration:
        "The launch speed splits into two parts, one along the ramp and one straight up. Gravity only ever changes the vertical part, so the sideways motion is as simple as a car cruising at a constant speed and needs no force to keep it going.",
      equations: ["x = v_0\\cos\\theta\\,t", "y = h + v_0\\sin\\theta\\,t - \\tfrac{1}{2}gt^2"],
      tStart: 0,
      tEnd: 0.5,
      focus: ["ball", "cliff"],
      showVectors: ["velocity", "gravityPull"],
      camera: camera([6, 7, 12], [1, 4.5, 0]),
    }),
    step({
      title: "Rising",
      narration:
        "While the upward part of the launch speed is bigger than gravity's pull the ball climbs. The top of the arc arrives when gravity has eaten all of that upward speed, which happens at the upward speed over gravity, and the height gained there is that speed squared over twice gravity.",
      equations: ["t_{apex} = \\frac{v_0\\sin\\theta}{g}", "H = h + \\frac{v_0^2\\sin^2\\theta}{2g}"],
      tStart: 0.5,
      tEnd: 1,
      focus: ["ball"],
      showVectors: ["velocity"],
      camera: camera([8, 8, 13], [4, 6, 0]),
    }),
    step({
      title: "Falling",
      narration:
        "Past the top the vertical part of the velocity points down and keeps growing, so the ball speeds up as it drops, while the sideways speed never changes at all. That is the whole trick: the two motions are independent and each one is easy.",
      equations: ["v_x = v_0\\cos\\theta", "v_y = v_0\\sin\\theta - gt"],
      tStart: 1,
      tEnd: 1.5,
      focus: ["ball"],
      showVectors: ["velocity", "gravityPull"],
      camera: camera([13, 7, 14], [9, 3, 0]),
    }),
    step({
      title: "Landed",
      narration:
        "The ball meets the ground when the fall has covered the height it was launched from plus the height it climbed, which is the launch speed's upward part plus the square root of its square plus twice gravity times the height, all over gravity. The range is just the sideways speed times that time of flight. Once it lands the scene clamps it to the ground and switches the velocity arrow off, so the rest of the timeline is a still frame.",
      equations: [
        "t_{hit} = \\frac{v_0\\sin\\theta + \\sqrt{v_0^2\\sin^2\\theta + 2gh}}{g}",
        "R = v_0\\cos\\theta\\,t_{hit}",
      ],
      tStart: 1.5,
      tEnd: 6,
      focus: ["ball", "landingMark"],
      showVectors: [],
      camera: camera([18, 6, 16], [14, 1, 0]),
    }),
  ],
  answers: [
    answer("Time of flight", PROJECTILE_FLIGHT, 1.640677262, "s"),
    answer(
      "Horizontal range from the cliff base",
      `v0*cos(theta*pi/180)*${PROJECTILE_FLIGHT}`,
      14.208681882,
      "m",
    ),
    answer("Peak height above the ground", `h+(${PROJECTILE_UP})^2/(2*g)`, 6.27420999, "m"),
  ],
};

const SLOPE_ACCEL = "(g*(sin(theta*pi/180)-mu*cos(theta*pi/180)))";
const SLOPE_DISTANCE_RAW = "(v0*t+0.5*((g*(sin(theta*pi/180)-mu*cos(theta*pi/180))))*t^2)";
const SLOPE_DISTANCE = `min(max(${SLOPE_DISTANCE_RAW},0),7.4)`;
const SLOPE_DISTANCE_2S = `min(max(v0*2+0.5*((g*(sin(theta*pi/180)-mu*cos(theta*pi/180))))*2^2,0),7.4)`;
const SLOPE_SPEED = `min(max(v0+${SLOPE_ACCEL}*t,0),sqrt(2*max(${SLOPE_ACCEL},0)*7.4))`;
const SLOPE_FRICTION = "min(mu*m*g*cos(theta*pi/180),m*g*sin(theta*pi/180))";

export const inclinePreset: SceneScript = {
  title: "Block sliding down a rough incline",
  problemText:
    "A 2 kg block is released on a 30 degree ramp with a friction coefficient of 0.2 and slides 6.41 m in the first 2 s. Friction is kinetic while the block slides and the block stops dead at the end of the ramp instead of running off it. Push the friction slider past 0.58, which is tan 30 degrees, and the block stays put because friction can hold it. Ramp and block rotations are in degrees. The drawn ramp is 8 m long and the travel is clamped to 7.4 m so the block stays on the slope.",
  variables: [
    fixed("theta", 30, "deg", "Ramp angle"),
    variable("mu", 0.2, "", "Friction coefficient", true, 0, 0.6, 0.01),
    variable("m", 2, "kg", "Block mass", true, 0.5, 6, 0.1),
    variable("v0", 0, "m/s", "Starting speed", true, 0, 4, 0.1),
    fixed("g", 9.81, "m/s^2", "Gravity"),
  ],
  duration: 2,
  loop: false,
  world: world("g"),
  camera: camera([12, 7, 14], [4, 2, 0]),
  objects: [
    object({
      id: "ramp",
      shape: "ramp",
      size: { x: 8, y: 0.3, z: 2, radius: 0 },
      position: point("4*cos(theta*pi/180)", "4*sin(theta*pi/180)", 0),
      rotation: point(0, 0, "-theta*pi/180"),
      color: BOARD,
      label: "ramp",
    }),
    object({
      id: "ground",
      shape: "box",
      size: { x: 20, y: 0.2, z: 12, radius: 0 },
      position: point(3, -0.1, 0),
      color: BOARD,
      label: "ground",
    }),
    object({
      id: "block",
      shape: "box",
      size: { x: 0.6, y: 0.4, z: 0.6, radius: 0 },
      position: point(
        `${SLOPE_DISTANCE}*cos(theta*pi/180)+0.2*sin(theta*pi/180)`,
        `(8-${SLOPE_DISTANCE})*sin(theta*pi/180)+0.2*cos(theta*pi/180)`,
        0,
      ),
      rotation: point(0, 0, "-theta*pi/180"),
      color: PEACH,
      label: "block",
      trail: true,
    }),
  ],
  connectors: [],
  vectors: [
    vector({
      id: "weight",
      attachTo: "block",
      kind: "force",
      components: point(0, "-m*g", 0),
      label: "weight",
      color: LAVENDER,
    }),
    vector({
      id: "normal",
      attachTo: "block",
      kind: "force",
      components: point(
        "m*g*sin(theta*pi/180)*cos(theta*pi/180)",
        "m*g*cos(theta*pi/180)*cos(theta*pi/180)",
        0,
      ),
      label: "normal",
      color: MINT,
    }),
    vector({
      id: "friction",
      attachTo: "block",
      kind: "force",
      components: point(
        `-${SLOPE_FRICTION}*cos(theta*pi/180)`,
        `${SLOPE_FRICTION}*sin(theta*pi/180)`,
        0,
      ),
      label: "friction",
      color: PEACH,
    }),
    vector({
      id: "velocity",
      attachTo: "block",
      kind: "velocity",
      components: point(
        `${SLOPE_SPEED}*cos(theta*pi/180)`,
        `-${SLOPE_SPEED}*sin(theta*pi/180)`,
        0,
      ),
      label: "velocity",
      color: CHALK,
    }),
  ],
  steps: [
    step({
      title: "Forces on the block",
      narration:
        "Three forces act. Weight pulls straight down, the ramp pushes back along its normal, and friction acts up the slope. Only the component of weight along the slope is left to accelerate the block, so what matters is the difference between that component and friction.",
      equations: [
        "N = mg\\cos\\theta",
        "f = \\mu N",
        "a = g(\\sin\\theta - \\mu\\cos\\theta)",
      ],
      tStart: 0,
      tEnd: 0.5,
      focus: ["block", "ramp"],
      showVectors: ["weight", "normal", "friction"],
      camera: camera([7, 6, 11], [2, 3, 0]),
    }),
    step({
      title: "Building speed",
      narration:
        "Because the net force along the ramp and the mass are both constant, the acceleration is constant too, and speed grows in a straight line with time. A bigger mass makes the block heavier but does not change its acceleration, because friction grows with the same weight.",
      equations: ["v = v_0 + at", "a = \\frac{mg\\sin\\theta - \\mu N}{m}"],
      tStart: 0.5,
      tEnd: 1,
      focus: ["block"],
      showVectors: ["velocity", "friction"],
      camera: camera([9, 6, 12], [3, 2.5, 0]),
    }),
    step({
      title: "Halfway down",
      narration:
        "Constant acceleration means the average speed over any interval is half way between the start and end speeds, so the distance is a half of at squared. Each second therefore covers more ground than the one before it.",
      equations: ["s = v_0 t + \\tfrac{1}{2}at^2"],
      tStart: 1,
      tEnd: 1.5,
      focus: ["block"],
      showVectors: ["velocity"],
      camera: camera([11, 6, 13], [4.5, 1.8, 0]),
    }),
    step({
      title: "End of the run",
      narration:
        "The block does not come to rest while the slope pulls harder than friction, it just keeps speeding up until it runs out of ramp. Starting from rest it reaches the far end at the square root of twice the ramp length over the acceleration, so a gentler slope or a slicker block gets it there later. Push friction past the tangent of the ramp angle and the block never starts at all.",
      equations: ["t_{end} = \\sqrt{\\frac{2L}{a}}", "\\tan\\theta > \\mu"],
      tStart: 1.5,
      tEnd: 2,
      focus: ["block", "ramp"],
      showVectors: ["velocity", "friction"],
      camera: camera([13, 5, 13], [6, 1, 0]),
    }),
  ],
  answers: [
    answer("Distance travelled in the first 2 seconds", SLOPE_DISTANCE_2S, 6.411716316, "m"),
    answer("Acceleration down the ramp", SLOPE_ACCEL, 3.205858158, "m/s^2"),
    answer("Friction force on the block", SLOPE_FRICTION, 3.398283684, "N"),
  ],
};

const ATWOOD_ACCEL = "((m1-m2)*g/(m1+m2))";
const ATWOOD_LIMIT = 1.4;
const ATWOOD_RAW = `0.5*${ATWOOD_ACCEL}*t^2`;
const ATWOOD_TRAVEL = `min(max(${ATWOOD_RAW},-${ATWOOD_LIMIT}),${ATWOOD_LIMIT})`;
const ATWOOD_SPENT = `abs(${ATWOOD_RAW})>=${ATWOOD_LIMIT}`;
const ATWOOD_HEAVY_SPEED = `${ATWOOD_SPENT} ? 0 : -${ATWOOD_ACCEL}*t`;
const ATWOOD_LIGHT_SPEED = `${ATWOOD_SPENT} ? 0 : ${ATWOOD_ACCEL}*t`;
const ATWOOD_TRAVEL_1S = `min(max(0.5*${ATWOOD_ACCEL}*1^2,-${ATWOOD_LIMIT}),${ATWOOD_LIMIT})`;
const ATWOOD_TENSION = "(2*m1*m2*g/(m1+m2))";

export const atwoodPreset: SceneScript = {
  title: "Atwood machine",
  problemText:
    "Two blocks hang from an ideal rope over a frictionless pulley, with the heavier block starting level with the lighter one. Both may travel 1.4 m before the rope runs out, so the lighter block stops below the pulley rather than passing through it, and the motion is clamped there. The rope never stretches, so both blocks always move the same distance in opposite directions and the heavier block wins whichever way the masses are set.",
  variables: [
    variable("m1", 5, "kg", "Heavy block", true, 2, 10, 0.1),
    variable("m2", 3, "kg", "Light block", true, 0.5, 4, 0.1),
    fixed("g", 9.81, "m/s^2", "Gravity"),
  ],
  duration: 1.2,
  loop: false,
  world: world("g"),
  camera: camera([6, 5, 13], [0, 3.4, 0]),
  objects: [
    object({
      id: "beam",
      shape: "box",
      size: { x: 3.6, y: 0.2, z: 0.3, radius: 0 },
      position: point(0, 6.5, 0),
      color: BOARD,
      label: "beam",
    }),
    object({
      id: "pulley",
      shape: "pulley",
      size: { x: 0.7, y: 0.7, z: 0.24, radius: 0.35 },
      position: point(0, 6, 0),
      color: PIPE,
      label: "pulley",
    }),
    object({
      id: "heavy",
      shape: "box",
      size: { x: 0.7, y: 0.7, z: 0.7, radius: 0 },
      position: point(-0.9, `min(5.4,max(0,4-${ATWOOD_TRAVEL}))`, 0),
      color: PEACH,
      label: "m1",
      trail: true,
    }),
    object({
      id: "light",
      shape: "box",
      size: { x: 0.7, y: 0.7, z: 0.7, radius: 0 },
      position: point(0.9, `min(5.4,max(0,4+${ATWOOD_TRAVEL}))`, 0),
      color: MINT,
      label: "m2",
      trail: true,
    }),
    object({
      id: "ground",
      shape: "box",
      size: { x: 10, y: 0.2, z: 8, radius: 0 },
      position: point(0, -0.1, 0),
      color: BOARD,
      label: "ground",
    }),
  ],
  connectors: [ropeConnector("ropeLeft", "heavy", "pulley"), ropeConnector("ropeRight", "pulley", "light")],
  vectors: [
    vector({
      id: "weight1",
      attachTo: "heavy",
      kind: "force",
      components: point(0, "-m1*g", 0),
      label: "m1 g",
      color: LAVENDER,
    }),
    vector({
      id: "weight2",
      attachTo: "light",
      kind: "force",
      components: point(0, "-m2*g", 0),
      label: "m2 g",
      color: LAVENDER,
    }),
    vector({
      id: "tension1",
      attachTo: "heavy",
      kind: "force",
      components: point(0, ATWOOD_TENSION, 0),
      label: "tension",
      color: MINT,
    }),
    vector({
      id: "tension2",
      attachTo: "light",
      kind: "force",
      components: point(0, ATWOOD_TENSION, 0),
      label: "tension",
      color: MINT,
    }),
    vector({
      id: "velocity1",
      attachTo: "heavy",
      kind: "velocity",
      components: point(0, ATWOOD_HEAVY_SPEED, 0),
      label: "velocity",
      color: CHALK,
    }),
    vector({
      id: "velocity2",
      attachTo: "light",
      kind: "velocity",
      components: point(0, ATWOOD_LIGHT_SPEED, 0),
      label: "velocity",
      color: CHALK,
    }),
  ],
  steps: [
    step({
      title: "Two weights, one rope",
      narration:
        "The heavier block pulls harder than the lighter one, so there is a net pull along the rope. Because the rope cannot stretch, that same net pull has to accelerate both masses together, which is why the acceleration is set by the difference in weights divided by the total mass.",
      equations: ["m_1 g - m_2 g = (m_1 + m_2)a", "a = \\frac{(m_1 - m_2)g}{m_1 + m_2}"],
      tStart: 0,
      tEnd: 0.3,
      focus: ["heavy", "light", "pulley"],
      showVectors: ["weight1", "weight2", "tension1", "tension2"],
      camera: camera([3, 5, 12], [0, 4, 0]),
    }),
    step({
      title: "Same rope, same speed",
      narration:
        "The rope constraint forces both blocks to share one acceleration, equal in size and opposite in direction. The pulley only bends the rope, it never changes how hard the blocks pull or how fast they move.",
      equations: ["a_1 = a_2 = a"],
      tStart: 0.3,
      tEnd: 0.6,
      focus: ["heavy", "light"],
      showVectors: ["velocity1", "velocity2"],
      camera: camera([6, 5, 13], [0, 3.4, 0]),
    }),
    step({
      title: "Speed and distance grow together",
      narration:
        "Acceleration is constant, so speed grows in a straight line and distance grows as a half of at squared. The heavier block travels just as far as the lighter one, because they are tied together, even though it has more mass and more momentum. Momentum is not conserved here in the usual sense, since gravity is an outside force doing work on the pair.",
      equations: ["s = \\tfrac{1}{2}at^2", "v = at"],
      tStart: 0.6,
      tEnd: 0.9,
      focus: ["heavy", "light"],
      showVectors: ["velocity1", "velocity2"],
      camera: camera([7, 4, 12], [0, 3, 0]),
    }),
    step({
      title: "Rope runs out",
      narration:
        "The lighter block would reach the pulley after the square root of twice the available travel over the acceleration, and the scene clamps there so neither block passes through the pulley. The clamp stops the motion outright, so the velocity arrows drop to zero rather than keeping a capped value. The tension stays constant throughout, and it always sits between the two weights: smaller than the heavy block's weight, which is why the heavy block accelerates downwards, and larger than the light block's weight, which is why the light block accelerates upwards.",
      equations: [
        "t_{stop} = \\sqrt{\\frac{2L}{a}}",
        "T = m_1(g - a) = \\frac{2m_1m_2 g}{m_1 + m_2}",
      ],
      tStart: 0.9,
      tEnd: 1.2,
      focus: ["light", "pulley"],
      showVectors: ["tension2", "velocity2"],
      camera: camera([4, 6, 11], [0, 4.5, 0]),
    }),
  ],
  answers: [
    answer("Acceleration of the system", ATWOOD_ACCEL, 2.4525, "m/s^2"),
    answer("Distance each block moves in the first second", ATWOOD_TRAVEL_1S, 1.22625, "m"),
    answer("Tension in the rope", ATWOOD_TENSION, 36.7875, "N"),
  ],
};

const ORBIT_RADIUS_M = "(R*1000000)";
const ORBIT_DRAW_R = 3.2;
const ORBIT_OMEGA = `(physicalSecondsPerTimelineSecond/sqrt((${ORBIT_RADIUS_M})^3/GM))`;
const ORBIT_THETA = `(t*${ORBIT_OMEGA})`;
const ORBIT_DRAW_SPEED = `(${ORBIT_DRAW_R}*${ORBIT_OMEGA})`;
const ORBIT_DRAW_ACCEL = `(${ORBIT_DRAW_R}*(${ORBIT_OMEGA})^2)`;
const ORBIT_SPEED = `(sqrt(GM/${ORBIT_RADIUS_M}))`;
const ORBIT_PERIOD = `(2*pi*sqrt((${ORBIT_RADIUS_M})^3/GM))`;
const ORBIT_GRAVITY = `(GM/(${ORBIT_RADIUS_M})^2)`;

export const orbitPreset: SceneScript = {
  title: "Satellite in circular orbit",
  problemText:
    "A satellite circles Earth at 10000 km measured from the centre of the planet, which is 3629 km above the surface and well clear of the atmosphere. At that distance gravity supplies 3.986 m per second squared and the satellite must travel 6313 m per second, going all the way round in 9952 s. Two deliberate distortions keep the scene watchable. First, the orbit is always drawn at 3.2 scene units whatever the radius slider says, because 10000 km at true scale would put the satellite far outside the frame, so the drawn circle is a scale model and not a map. Second, the timeline is compressed: every second on screen stands for 60 physical seconds, so the 120 s timeline covers 7200 physical seconds, which is most of one revolution but not quite all of it, and the period is left to the answers rather than to playback. The answers are the real physical values in metres, seconds and m per second squared, and the arrow lengths are in drawn units per timeline second rather than m per second.",
  variables: [
    variable("R", 10, "1000 km", "Orbit radius from Earth's centre", true, 7, 14, 0.1),
    fixed("GM", 3.986004418e14, "m^3/s^2", "GM of Earth"),
    fixed("physicalSecondsPerTimelineSecond", 60, "s", "Physical seconds per timeline second"),
  ],
  duration: 120,
  loop: false,
  world: world(0),
  camera: camera([11, 13, 20], [1, 0, 0]),
  objects: [
    object({
      id: "planet",
      shape: "planet",
      size: { x: 4.4, y: 4.4, z: 4.4, radius: 2.2 },
      position: point(0, 0, 0),
      color: "#5b8ec4",
      label: "Earth",
    }),
    object({
      id: "orbitPlane",
      shape: "cylinder",
      size: { x: 6.4, y: 0.02, z: 6.4, radius: 3.2 },
      position: point(0, -0.03, 0),
      color: "#26333d",
      label: "orbital plane",
    }),
    object({
      id: "satellite",
      shape: "sphere",
      size: { x: 0.34, y: 0.34, z: 0.34, radius: 0.17 },
      position: point(`${ORBIT_DRAW_R}*cos(${ORBIT_THETA})`, `${ORBIT_DRAW_R}*sin(${ORBIT_THETA})`, 0),
      color: PEACH,
      label: "satellite",
      trail: true,
    }),
  ],
  connectors: [],
  vectors: [
    vector({
      id: "velocity",
      attachTo: "satellite",
      kind: "velocity",
      components: point(`-${ORBIT_DRAW_SPEED}*sin(${ORBIT_THETA})`, `${ORBIT_DRAW_SPEED}*cos(${ORBIT_THETA})`, 0),
      label: "velocity",
      color: MINT,
    }),
    vector({
      id: "gravityPull",
      attachTo: "satellite",
      kind: "acceleration",
      components: point(
        `-${ORBIT_DRAW_ACCEL}*cos(${ORBIT_THETA})`,
        `-${ORBIT_DRAW_ACCEL}*sin(${ORBIT_THETA})`,
        0,
      ),
      label: "gravity",
      color: LAVENDER,
    }),
  ],
  steps: [
    step({
      title: "Falling around the planet",
      narration:
        "The satellite is not orbiting because it is fast, it is orbiting because it keeps missing. Gravity is the only force acting and it points straight at the centre of Earth, so the path curves inward and the satellite falls around the planet instead of into it.",
      equations: ["F = \\frac{GMm}{r^2}", "a = \\frac{GM}{r^2}"],
      tStart: 0,
      tEnd: 30,
      focus: ["satellite", "planet"],
      showVectors: ["gravityPull"],
      camera: camera([8, 8, 16], [1, 0, 0]),
    }),
    step({
      title: "Speed stays constant",
      narration:
        "The speed never changes, because gravity is pulling at right angles to the velocity and can only turn the direction. Only the direction of the arrow rotates, and it takes a full period to come back to the same heading.",
      equations: ["v = \\sqrt{\\frac{GM}{r}}", "v^2 = \\frac{GM}{r}"],
      tStart: 30,
      tEnd: 60,
      focus: ["satellite"],
      showVectors: ["velocity"],
      camera: camera([10, 10, 18], [1.5, 0.5, 0]),
    }),
    step({
      title: "Circular means centripetal",
      narration:
        "The inward acceleration needed to keep the path circular is exactly the acceleration gravity provides, which is why the orbit never drifts in or out. The smaller the circle, the faster the satellite has to go and the shorter the period.",
      equations: ["\\frac{v^2}{r} = \\frac{GM}{r^2}", "T = 2\\pi\\sqrt{\\frac{r^3}{GM}}"],
      tStart: 60,
      tEnd: 90,
      focus: ["satellite", "orbitPlane"],
      showVectors: ["velocity", "gravityPull"],
      camera: camera([12, 14, 20], [1, 0, 0]),
    }),
    step({
      title: "Changing the orbit",
      narration:
        "Drag the radius slider and the answers move the way the third power law says they must. A bigger orbit means weaker gravity, a lower speed and a much longer period, because the period grows as radius to the three halves. The drawn circle stays the same size, so only the timing and the numbers change.",
      equations: ["T \\propto r^{3/2}", "v \\propto r^{-1/2}"],
      tStart: 90,
      tEnd: 120,
      focus: ["satellite", "planet"],
      showVectors: ["velocity"],
      camera: camera([14, 16, 22], [1, 0, 0]),
    }),
  ],
  answers: [
    answer("Orbital speed", ORBIT_SPEED, 6313.4811, "m/s"),
    answer("Time for one orbit", ORBIT_PERIOD, 9952.0139, "s"),
    answer("Gravity at that distance", ORBIT_GRAVITY, 3.986004418, "m/s^2"),
  ],
};

const CART_T_HIT = "((x2-x1-1)/v1)";
const CART_V1_AFTER = "((m1-m2)/(m1+m2)*v1)";
const CART_V2_AFTER = "(2*m1/(m1+m2)*v1)";

export const collisionPreset: SceneScript = {
  title: "Elastic collision between two carts",
  problemText:
    "A 2 kg cart rolling at 3 m per second hits a 1 kg cart that is standing still, and the collision is perfectly elastic. The carts are 1 m long, so they touch when their centres are 1 m apart, which is 2.5 m of closing at 3 m per second, so the hit happens about 0.83 s in. Both carts keep their original direction of travel because the mass ratio is only two to one, and the carts are drawn 1 m long to match the contact rule. Nothing is deformed and nothing is lost, so momentum and kinetic energy both come through unchanged.",
  variables: [
    variable("m1", 2, "kg", "Cart 1 mass", true, 1, 5, 0.1),
    variable("m2", 1, "kg", "Cart 2 mass", true, 0.5, 3, 0.1),
    variable("v1", 3, "m/s", "Cart 1 speed", true, 0.5, 6, 0.1),
    fixed("x1", -6, "m", "Cart 1 start"),
    fixed("x2", -2.5, "m", "Cart 2 start"),
  ],
  duration: 3,
  loop: false,
  world: world(0),
  camera: camera([1, 5, 15], [0, 0.8, 0]),
  objects: [
    object({
      id: "ground",
      shape: "box",
      size: { x: 40, y: 0.2, z: 10, radius: 0 },
      position: point(0, -0.1, 0),
      color: BOARD,
      label: "ground",
    }),
    object({
      id: "cart1",
      shape: "car",
      size: { x: 1, y: 0.7, z: 0.9, radius: 0.22 },
      position: point(
        `t<${CART_T_HIT} ? x1+v1*t : x1+v1*${CART_T_HIT}+${CART_V1_AFTER}*(t-${CART_T_HIT})`,
        0.35,
        0,
      ),
      color: PEACH,
      label: "cart 1",
      trail: true,
    }),
    object({
      id: "cart2",
      shape: "car",
      size: { x: 1, y: 0.7, z: 0.9, radius: 0.22 },
      position: point(
        `t<${CART_T_HIT} ? x2 : x2+${CART_V2_AFTER}*(t-${CART_T_HIT})`,
        0.35,
        0,
      ),
      color: MINT,
      label: "cart 2",
      trail: true,
    }),
  ],
  connectors: [],
  vectors: [
    vector({
      id: "velocity1",
      attachTo: "cart1",
      kind: "velocity",
      components: point(`t<${CART_T_HIT} ? v1 : ${CART_V1_AFTER}`, 0, 0),
      label: "cart 1 velocity",
      color: PEACH,
    }),
    vector({
      id: "velocity2",
      attachTo: "cart2",
      kind: "velocity",
      components: point(`t<${CART_T_HIT} ? 0 : ${CART_V2_AFTER}`, 0, 0),
      label: "cart 2 velocity",
      color: MINT,
    }),
    vector({
      id: "momentum1",
      attachTo: "cart1",
      kind: "momentum",
      components: point(`m1*(t<${CART_T_HIT} ? v1 : ${CART_V1_AFTER})`, 0, 0),
      label: "cart 1 momentum",
      color: LAVENDER,
    }),
    vector({
      id: "momentum2",
      attachTo: "cart2",
      kind: "momentum",
      components: point(`m2*(t<${CART_T_HIT} ? 0 : ${CART_V2_AFTER})`, 0, 0),
      label: "cart 2 momentum",
      color: LAVENDER,
    }),
  ],
  steps: [
    step({
      title: "Before the hit",
      narration:
        "One cart rolls in carrying all of the system's momentum and all of its kinetic energy, while the other stands still. The carts are a fixed length apart, so the time of the hit is found by closing the gap between their centres at the incoming speed.",
      equations: ["p = m_1 v_1", "E_k = \\tfrac{1}{2}m_1 v_1^2"],
      tStart: 0,
      tEnd: 0.8,
      focus: ["cart1", "cart2"],
      showVectors: ["velocity1", "momentum1"],
      camera: camera([0, 4, 14], [-2, 0.8, 0]),
    }),
    step({
      title: "Contact",
      narration:
        "The carts touch when their centres are exactly one cart length apart. In a perfectly elastic collision no kinetic energy is lost, it is only handed from the heavier cart to the lighter one, and the pair keeps the same total momentum.",
      equations: ["E_{k,before} = E_{k,after}"],
      tStart: 0.8,
      tEnd: 0.87,
      focus: ["cart1", "cart2"],
      showVectors: ["velocity1", "velocity2"],
      camera: camera([0, 3, 9], [-1.5, 0.6, 0]),
    }),
    step({
      title: "After the hit",
      narration:
        "Each new speed is set by the mass ratio. The incoming cart keeps a share of the original speed equal to the mass difference over the total mass, and the struck cart leaves with twice the incoming mass over the total mass times the original speed. A heavier cart that hits a lighter one always carries on forwards, and a lighter one hitting a heavier one bounces back.",
      equations: [
        "v_1' = \\frac{m_1 - m_2}{m_1 + m_2}v_1",
        "v_2' = \\frac{2m_1}{m_1 + m_2}v_1",
      ],
      tStart: 0.87,
      tEnd: 1.9,
      focus: ["cart1", "cart2"],
      showVectors: ["velocity1", "velocity2"],
      camera: camera([1, 4, 12], [0, 0.8, 0]),
    }),
    step({
      title: "Check the books",
      narration:
        "Adding the two new momenta gives exactly the momentum the carts arrived with, and the two new kinetic energies add to exactly the energy they arrived with. That is what elastic means: nothing is created, nothing is destroyed, and the mass weighting is what decides the split.",
      equations: ["m_1 v_1 = m_1 v_1' + m_2 v_2'"],
      tStart: 1.9,
      tEnd: 3,
      focus: ["cart1", "cart2"],
      showVectors: ["momentum1", "momentum2"],
      camera: camera([2, 5, 14], [2, 0.8, 0]),
    }),
  ],
  answers: [
    answer("Cart 1 speed after the collision", CART_V1_AFTER, 1, "m/s"),
    answer("Cart 2 speed after the collision", CART_V2_AFTER, 4, "m/s"),
    answer(
      "Kinetic energy lost in the collision",
      `0.5*m1*${CART_V1_AFTER}^2+0.5*m2*${CART_V2_AFTER}^2-0.5*m1*v1^2`,
      0,
      "J",
    ),
    answer("Change in total momentum", `m1*${CART_V1_AFTER}+m2*${CART_V2_AFTER}-m1*v1`, 0, "kg m/s"),
  ],
};

const FLUID_V2 = "(v1*(r1/r2)^2)";

function tracerX(startOffset: number): string {
  const start = formatNumber(-2.4 + startOffset);
  const runToThroat = formatNumber(Number((1.5 - startOffset).toFixed(4)));
  return `t<(${runToThroat}/v1) ? ${start}+v1*t : min(-0.9+${FLUID_V2}*(t-${runToThroat}/v1),0.6)`;
}

const TRACER_OFFSETS = [0, 0.2, 0.4, 0.6, 0.8];
const TRACER_COLORS = [MINT, PEACH, LAVENDER, MINT, PEACH];

export const fluidPreset: SceneScript = {
  title: "Water through a narrowing pipe",
  problemText:
    "Water at 2 m per second flows through a 0.10 m radius pipe that narrows to 0.05 m radius, and the pressure drops from 101325 Pa to 71325 Pa. The pipe is drawn larger than life and set just behind the flow so the coloured tracer spheres stay visible. The flow is steady, so every tracer keeps the same speed in the wide section and the same faster speed in the throat, with A1 v1 = A2 v2 holding the volume flow constant. Bernoulli is applied along a horizontal streamline, so height does not enter and friction and viscosity are ignored.",
  variables: [
    fixed("r1", 0.1, "m", "Inlet radius"),
    fixed("r2", 0.05, "m", "Throat radius"),
    variable("v1", 2, "m/s", "Inlet speed", true, 0.5, 3, 0.1),
    fixed("rho", 1000, "kg/m^3", "Water density"),
    fixed("p1", 101325, "Pa", "Inlet pressure"),
  ],
  duration: 1.6,
  loop: true,
  world: world(0),
  camera: camera([-0.9, 1.4, 5.5], [-0.9, 0, -0.1]),
  objects: [
    object({
      id: "stand",
      shape: "box",
      size: { x: 5, y: 0.08, z: 1.4, radius: 0 },
      position: point(-0.9, -0.45, -0.3),
      color: BOARD,
      label: "stand",
    }),
    object({
      id: "pipeWide",
      shape: "cylinder",
      size: { x: 1.2, y: 0.6, z: 0.6, radius: 0.3 },
      position: point(-1.8, 0, -0.3),
      rotation: point(0, 0, "pi/2"),
      color: PIPE,
      label: "inlet, r = 0.10 m",
    }),
    object({
      id: "reducer",
      shape: "cone",
      size: { x: 0.6, y: 0.6, z: 0.6, radius: 0.3 },
      position: point(-0.9, 0, -0.3),
      rotation: point(0, 0, "pi/2"),
      color: PIPE,
      label: "contraction",
    }),
    object({
      id: "pipeNarrow",
      shape: "cylinder",
      size: { x: 1.2, y: 0.3, z: 0.3, radius: 0.15 },
      position: point(0, 0, -0.3),
      rotation: point(0, 0, "pi/2"),
      color: PIPE,
      label: "throat, r = 0.05 m",
    }),
    ...TRACER_OFFSETS.map((offset, index) =>
      object({
        id: `tracer${index + 1}`,
        shape: "sphere",
        size: { x: 0.08, y: 0.08, z: 0.08, radius: 0.04 },
        position: point(tracerX(offset), 0, 0),
        color: TRACER_COLORS[index],
        label: `tracer ${index + 1}`,
        trail: true,
      }),
    ),
  ],
  connectors: [],
  vectors: [
    vector({
      id: "inletSpeed",
      attachTo: "pipeWide",
      kind: "velocity",
      components: point("v1", 0, 0),
      label: "inlet speed",
      color: MINT,
    }),
    vector({
      id: "throatSpeed",
      attachTo: "pipeNarrow",
      kind: "velocity",
      components: point(FLUID_V2, 0, 0),
      label: "throat speed",
      color: PEACH,
    }),
  ],
  steps: [
    step({
      title: "Volume flow is constant",
      narration:
        "For a steady flow the same volume of water has to pass every cross section each second, so area times speed is constant along the pipe. The area goes with the square of the radius, so the speed has to go with the ratio of the radii squared. Halving the radius therefore means four times the speed.",
      equations: ["A_1 v_1 = A_2 v_2", "v_2 = v_1\\left(\\frac{r_1}{r_2}\\right)^2"],
      tStart: 0,
      tEnd: 0.4,
      focus: ["pipeWide", "pipeNarrow", "tracer1"],
      showVectors: ["inletSpeed", "throatSpeed"],
      camera: camera([-1.6, 1.2, 4.6], [-1.4, 0, -0.1]),
    }),
    step({
      title: "Speed jumps at the throat",
      narration:
        "Watch the tracer spheres. Each one cruises along the wide pipe at the inlet speed and then crosses the contraction faster, by exactly the ratio of the radii squared, and it never slows down again afterwards. Every tracer makes the same jump at the same place, which is what steady flow looks like.",
      equations: ["\\frac{v_2}{v_1} = \\left(\\frac{r_1}{r_2}\\right)^2"],
      tStart: 0.4,
      tEnd: 0.8,
      focus: ["tracer1", "tracer2", "tracer3"],
      showVectors: ["throatSpeed"],
      camera: camera([-0.6, 1, 4.2], [-0.3, 0, -0.1]),
    }),
    step({
      title: "Faster means lower pressure",
      narration:
        "Bernoulli along a horizontal streamline says the pressure has to drop as the speed rises, by half the density times the change in the speed squared. Height never enters here because the pipe is level, and friction and viscosity are being ignored.",
      equations: [
        "p_1 + \\tfrac{1}{2}\\rho v_1^2 = p_2 + \\tfrac{1}{2}\\rho v_2^2",
        "p_2 = p_1 + \\tfrac{1}{2}\\rho\\left(v_1^2 - v_2^2\\right)",
      ],
      tStart: 0.8,
      tEnd: 1.2,
      focus: ["pipeNarrow", "tracer4"],
      showVectors: ["throatSpeed"],
      camera: camera([0.2, 0.9, 3.8], [0.2, 0, -0.1]),
    }),
    step({
      title: "Same volume, different pressure",
      narration:
        "Squaring the speeds means the pressure drop grows faster than the speed does, so a gentle narrowing produces a surprisingly large pressure difference. That difference is exactly what a Venturi meter measures, which is why the narrow end is the dangerous end. Push the inlet speed up and watch the throat pressure fall away.",
      equations: ["\\Delta p = p_1 - p_2 = \\tfrac{1}{2}\\rho\\left(v_2^2 - v_1^2\\right)"],
      tStart: 1.2,
      tEnd: 1.6,
      focus: ["pipeWide", "pipeNarrow", "tracer5"],
      showVectors: ["inletSpeed", "throatSpeed"],
      camera: camera([-0.9, 1.6, 5.2], [-0.9, 0, -0.1]),
    }),
  ],
  answers: [
    answer("Speed in the narrow section", FLUID_V2, 8, "m/s"),
    answer("Pressure in the narrow section", `p1+0.5*rho*(v1^2-${FLUID_V2}^2)`, 71325, "Pa"),
    answer("Pressure drop across the contraction", `0.5*rho*(${FLUID_V2}^2-v1^2)`, 30000, "Pa"),
  ],
};

const WAVE_SPHERE_COUNT = 21;

function waveX(index: number): string {
  return index === 0 ? "0" : `${index}*dx`;
}

function waveY(index: number): string {
  const phase = index === 0 ? "0" : `2*pi*${index}*dx/wavelength`;
  return `A*sin(${phase}-2*pi*f*t)`;
}

export const wavePreset: SceneScript = {
  title: "Transverse wave along a string",
  problemText:
    "A travelling wave of amplitude 0.35 m and frequency 0.5 Hz runs along a string whose wavelength is 2 m, so every point of the string is simple harmonic motion about the rest position and the pattern travels at 1 m per second. The 21 marker spheres are spaced by dx, which is a slider, so the same wavelength is shared between more or fewer markers. The wave is drawn to scale in both amplitude and wavelength, and gravity is switched off because this is a string, not a falling object.",
  variables: [
    variable("A", 0.35, "m", "Amplitude", true, 0.05, 0.6, 0.01),
    variable("f", 0.5, "Hz", "Frequency", true, 0.1, 1.5, 0.05),
    fixed("wavelength", 2, "m", "Wavelength"),
    variable("dx", 0.25, "m", "Marker spacing", true, 0.15, 0.4, 0.01),
  ],
  duration: 5,
  loop: true,
  world: world(0),
  camera: camera([4, 3, 11], [4, 0, 0]),
  objects: [
    object({
      id: "base",
      shape: "box",
      size: { x: 9, y: 0.1, z: 0.6, radius: 0 },
      position: point(4, -0.85, 0),
      color: BOARD,
      label: "base",
    }),
    object({
      id: "postLeft",
      shape: "box",
      size: { x: 0.12, y: 1.1, z: 0.12, radius: 0 },
      position: point(0, -0.3, 0),
      color: PIPE,
      label: "left post",
    }),
    object({
      id: "postRight",
      shape: "box",
      size: { x: 0.12, y: 1.1, z: 0.12, radius: 0 },
      position: point(`${WAVE_SPHERE_COUNT - 1}*dx`, -0.3, 0),
      color: PIPE,
      label: "right post",
    }),
    ...Array.from({ length: WAVE_SPHERE_COUNT }, (_, index) =>
      object({
        id: `node${index}`,
        shape: "sphere",
        size: { x: 0.12, y: 0.12, z: 0.12, radius: 0.06 },
        position: point(waveX(index), waveY(index), 0),
        color: index % 2 === 0 ? CHALK : MINT,
        label: `marker ${index}`,
      }),
    ),
  ],
  connectors: [],
  vectors: [
    vector({
      id: "nodeVelocity",
      attachTo: "node4",
      kind: "velocity",
      components: point(0, `-A*2*pi*f*cos(2*pi*4*dx/wavelength-2*pi*f*t)`, 0),
      label: "transverse velocity",
      color: PEACH,
    }),
    vector({
      id: "nodeAcceleration",
      attachTo: "node4",
      kind: "acceleration",
      components: point(0, `-A*(2*pi*f)^2*sin(2*pi*4*dx/wavelength-2*pi*f*t)`, 0),
      label: "acceleration",
      color: LAVENDER,
    }),
  ],
  steps: [
    step({
      title: "A wave is a pattern, not a thing",
      narration:
        "Nothing travels along the string except the pattern itself. Each marker just swings up and down about its rest position and stays put, while the shape moves along at the wave speed, which is the frequency multiplied by the wavelength.",
      equations: ["y = A\\sin(kx - \\omega t)", "k = \\frac{2\\pi}{\\lambda}"],
      tStart: 0,
      tEnd: 1.25,
      focus: ["node0", "node2", "node4"],
      showVectors: ["nodeVelocity"],
      camera: camera([1.5, 1.4, 7], [1.5, 0, 0]),
    }),
    step({
      title: "Simple harmonic motion",
      narration:
        "Every marker repeats the same motion: a sine wave, which is simple harmonic motion. The vertical speed is the derivative of the sine, so it is largest at the rest position and vanishes at the top and bottom of the swing. The acceleration points back towards the rest position at all times, which is why the swing does not drift away.",
      equations: ["v_y = -A\\omega\\cos(kx - \\omega t)", "a_y = -A\\omega^2\\sin(kx - \\omega t)"],
      tStart: 1.25,
      tEnd: 2.5,
      focus: ["node4", "node6"],
      showVectors: ["nodeVelocity", "nodeAcceleration"],
      camera: camera([1.2, 1.2, 5.5], [1.2, 0, 0]),
    }),
    step({
      title: "One wavelength",
      narration:
        "Two markers separated by exactly one wavelength are always doing the same thing at the same moment, whatever the frequency and amplitude. That repeat spacing is the wavelength, and it is the same everywhere along a uniform string, so the pattern repeats itself once every wavelength as it travels.",
      equations: ["\\lambda = \\frac{2\\pi}{k}"],
      tStart: 2.5,
      tEnd: 3.75,
      focus: ["node0", "node8", "node16"],
      showVectors: [],
      camera: camera([2.2, 1.8, 9], [2.2, 0, 0]),
    }),
    step({
      title: "Speed is frequency times wavelength",
      narration:
        "One full cycle takes the period, which is one over the frequency, and in that time the pattern travels exactly one wavelength. Multiply them and you have the wave speed. Raising the frequency speeds the wave up without making it any taller, and raising the amplitude makes it taller without changing how fast it travels.",
      equations: ["v = f\\lambda = \\frac{\\omega}{k}", "T = \\frac{1}{f}"],
      tStart: 3.75,
      tEnd: 5,
      focus: ["node10", "node14", "node18"],
      showVectors: ["nodeVelocity"],
      camera: camera([4, 2.4, 10], [4, 0, 0]),
    }),
  ],
  answers: [
    answer("Wave speed", "f*wavelength", 1, "m/s"),
    answer("Period of one cycle", "1/f", 2, "s"),
    answer("Amplitude, the peak displacement", "A", 0.35, "m"),
    answer("Wavelength", "wavelength", 2, "m"),
  ],
};

export const presetList: Array<{ key: PresetKey; name: string; blurb: string }> = [
  ...advancedPresetList,
  {
    key: "projectile",
    name: "Projectile off a cliff",
    blurb: "A ball leaves a 5 m cliff at 10 m per second and 30 degrees. Time of flight, range and peak height all come from the closed form solution.",
  },
  {
    key: "incline",
    name: "Block on a rough incline",
    blurb: "A 2 kg block slides a 30 degree ramp with friction 0.2. Slide the friction past 0.58 and friction holds the block still.",
  },
  {
    key: "atwood",
    name: "Atwood machine",
    blurb: "A 5 kg block and a 3 kg block on one ideal rope. Same rope, same acceleration, opposite directions.",
  },
  {
    key: "orbit",
    name: "Satellite in circular orbit",
    blurb: "A satellite 10000 km from Earth's centre travels at 6313 m per second and comes round every 9952 s, held up by nothing but gravity.",
  },
  {
    key: "collision",
    name: "Elastic collision",
    blurb: "A 2 kg cart at 3 m per second hits a resting 1 kg cart. Momentum and kinetic energy both come out unchanged.",
  },
  {
    key: "fluid",
    name: "Flow through a narrowing pipe",
    blurb: "Water at 2 m per second meets half the radius and leaves four times faster, 30000 Pa lower in pressure.",
  },
  {
    key: "wave",
    name: "Wave along a string",
    blurb: "A 0.35 m amplitude, 0.5 Hz travelling wave. Markers only move up and down while the pattern moves at 1 m per second.",
  },
];

export const presets: Record<PresetKey, SceneScript> = {
  ...advancedPresets,
  projectile: projectilePreset,
  incline: inclinePreset,
  atwood: atwoodPreset,
  orbit: orbitPreset,
  collision: collisionPreset,
  fluid: fluidPreset,
  wave: wavePreset,
};
wavePreset.connectors=Array.from({length:WAVE_SPHERE_COUNT-1},(_,i)=>({id:`string${i}`,kind:"rope" as const,from:`node${i}`,to:`node${i+1}`}));
