import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileExpression, compileScene, ExpressionError } from "../lib/expressions";
import { SCENE_LIMITS, sceneScriptSchema, type SceneScript } from "../lib/schema";
import {
  atwoodPreset,
  collisionPreset,
  fluidPreset,
  inclinePreset,
  orbitPreset,
  presetList,
  presets,
  projectilePreset,
  wavePreset,
  type PresetKey,
} from "../lib/presets";
import {
  ANSWER_ABSOLUTE_TOLERANCE,
  ANSWER_RELATIVE_TOLERANCE,
  checkSceneScript,
  SAMPLE_COUNT,
  SceneValidationError,
  validateSceneScript,
} from "../lib/validate";

const G = 9.81;
const DEG = Math.PI / 180;

const close = (actual: number, expected: number, tolerance = 1e-9): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

const relClose = (actual: number, expected: number, tolerance = 1e-9): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `expected ${actual} to be within ${tolerance} relative of ${expected}`,
  );
};

const at = (sample: { objects: Array<{ id: string; position: [number, number, number] }> }, id: string) => {
  const found = sample.objects.find((entry) => entry.id === id);
  assert.ok(found, `scene has no object "${id}"`);
  return found.position;
};

const vectorAt = (
  sample: { vectors: Array<{ id: string; components: [number, number, number] }> },
  id: string,
) => {
  const found = sample.vectors.find((entry) => entry.id === id);
  assert.ok(found, `scene has no vector "${id}"`);
  return found.components;
};

const allFinite = (sample: { objects: unknown[]; vectors: unknown[]; gravity: number; answers: number[] }) => {
  for (const value of [sample.gravity, ...sample.answers]) {
    assert.ok(Number.isFinite(value), `expected a finite number, got ${String(value)}`);
  }
  for (const object of sample.objects as Array<{
    position: number[];
    rotation: number[];
    visible: unknown;
  }>) {
    for (const value of [...object.position, ...object.rotation]) {
      assert.ok(Number.isFinite(value), `object sample produced ${String(value)}`);
    }
    assert.equal(typeof object.visible, "boolean");
  }
  for (const vector of sample.vectors as Array<{
    components: number[];
    magnitude: number;
    visible: unknown;
  }>) {
    for (const value of [...vector.components, vector.magnitude]) {
      assert.ok(Number.isFinite(value), `vector sample produced ${String(value)}`);
    }
    assert.equal(typeof vector.visible, "boolean");
  }
};

const adjustableRanges = (scene: SceneScript): Record<string, number[]> => {
  const ranges: Record<string, number[]> = {};
  for (const variable of scene.variables) {
    if (variable.adjustable) {
      ranges[variable.name] = [variable.min, variable.max];
    }
  }
  return ranges;
};

describe("expression language rejects anything unsafe", () => {
  const rejected: Array<[string, string]> = [
    ["assignment", "a = 5"],
    ["function assignment", "f(x) = x"],
    ["property access", "a.b"],
    ["index access", "a[1]"],
    ["object literal", "{a: 1}"],
    ["array literal", "[1, 2]"],
    ["range", "1:5"],
    ["string literal", '"hello"'],
    ["import", 'import("x")'],
    ["evaluate", 'evaluate("1+1")'],
    ["derivative", 'derivative("x^2", "x")'],
    ["factorial", "5!"],
    ["percentage", "50%"],
    ["unknown symbol", "unknownSymbol + 1"],
    ["prototype symbol", "constructor"],
    ["prototype symbol", "toString"],
    ["call of a variable", "f(2)"],
    ["deeply nested calls", `${"sin(".repeat(40)}0${")".repeat(40)}`],
    ["too many nodes", Array.from({ length: 400 }, () => "1").join("+")],
    ["too long", `1+${"1".repeat(SCENE_LIMITS.maxExpressionLength)}`],
  ];

  for (const [label, source] of rejected) {
    it(`rejects ${label}`, () => {
      assert.throws(() => compileExpression(source, ["a", "f", "x"]), ExpressionError);
    });
  }

  it("rejects a variable named after a reserved symbol", () => {
    for (const name of ["t", "pi", "e", "i", "sin", "cos", "max"]) {
      assert.throws(() => compileExpression("1", [name]), ExpressionError, `expected "${name}" to be reserved`);
    }
  });

  it("rejects a variable name that is not an identifier", () => {
    assert.throws(() => compileExpression("1", ["1abc"]), ExpressionError);
    assert.throws(() => compileExpression("1", ["a b"]), ExpressionError);
    assert.throws(() => compileExpression("1", [""]), ExpressionError);
  });

  it("rejects a scope key the expression does not use", () => {
    const expression = compileExpression("a + 1", ["a"]);
    assert.throws(() => expression.evaluate({ a: 1, b: 2 }), ExpressionError);
  });

  it("rejects a non finite value in the scope", () => {
    const expression = compileExpression("a + 1", ["a"]);
    assert.throws(() => expression.evaluate({ a: Number.NaN }), ExpressionError);
    assert.throws(() => expression.evaluate({ a: Number.POSITIVE_INFINITY }), ExpressionError);
  });

  it("fails closed when a needed symbol is missing from the scope", () => {
    const expression = compileExpression("a * 2", ["a"]);
    assert.throws(() => expression.evaluate({}), ExpressionError);
  });

  it("rejects an expression whose value is not finite", () => {
    assert.throws(() => compileExpression("1/0").evaluate({}), ExpressionError);
    assert.throws(() => compileExpression("0/0").evaluate({}), ExpressionError);
    assert.throws(() => compileExpression("sqrt(-1)").evaluate({}), ExpressionError);
    assert.throws(() => compileExpression("ln(0)").evaluate({}), ExpressionError);
  });

  it("cannot be used to walk the prototype chain", () => {
    const polluted: Record<string, number> = Object.create(null) as Record<string, number>;
    polluted.a = 2;
    assert.throws(() => compileExpression("constructor").evaluate(polluted), ExpressionError);
  });
});

describe("expression language accepts the documented subset", () => {
  it("evaluates arithmetic, precedence and parentheses", () => {
    assert.equal(compileExpression("2+3*4").evaluate({}), 14);
    assert.equal(compileExpression("(2+3)*4").evaluate({}), 20);
    assert.equal(compileExpression("2^3^2").evaluate({}), 512);
    assert.equal(compileExpression("-3^2").evaluate({}), -9);
    assert.equal(compileExpression("7%3").evaluate({}), 1);
    assert.equal(compileExpression("10/4").evaluate({}), 2.5);
  });

  it("evaluates the allowed functions and constants", () => {
    assert.equal(compileExpression("sin(0)").evaluate({}), 0);
    assert.equal(compileExpression("cos(0)").evaluate({}), 1);
    assert.equal(compileExpression("tan(0)").evaluate({}), 0);
    assert.equal(compileExpression("sqrt(16)").evaluate({}), 4);
    assert.equal(compileExpression("abs(-3)").evaluate({}), 3);
    assert.equal(compileExpression("min(2, 5)").evaluate({}), 2);
    assert.equal(compileExpression("max(2, 5)").evaluate({}), 5);
    assert.equal(compileExpression("exp(0)").evaluate({}), 1);
    assert.equal(compileExpression("pi").evaluate({}), Math.PI);
    assert.equal(compileExpression("e").evaluate({}), Math.E);
  });

  it("evaluates t and declared variables from the scope", () => {
    const expression = compileExpression("v0*t + h", ["v0", "h"]);
    assert.equal(expression.evaluate({ v0: 2, h: 5, t: 3 }), 11);
  });

  it("evaluates comparisons and ternary conditionals", () => {
    assert.equal(compileExpression("t > 1").evaluate({ t: 2 }), true);
    assert.equal(compileExpression("t > 1").evaluate({ t: 0 }), false);
    assert.equal(compileExpression("t > 1 ? 10 : 20").evaluate({ t: 2 }), 10);
    assert.equal(compileExpression("t > 1 ? 10 : 20").evaluate({ t: 0 }), 20);
  });

  it("evaluates ternaries used by the presets", () => {
    const source = "t < 1 ? x1 + v1 * t : x1 + v1 + vAfter * (t - 1)";
    const expression = compileExpression(source, ["x1", "v1", "vAfter"]);
    assert.equal(expression.evaluate({ x1: 0, v1: 3, vAfter: 1, t: 0.5 }), 1.5);
    assert.equal(expression.evaluate({ x1: 0, v1: 3, vAfter: 1, t: 2 }), 4);
  });
});

describe("compileScene contract", () => {
  it("clamps t to the duration instead of extrapolating", () => {
    const compiled = compileScene(projectilePreset);
    const atStart = compiled.sample(0);
    const beforeStart = compiled.sample(-99);
    const atEnd = compiled.sample(projectilePreset.duration);
    const afterEnd = compiled.sample(1e6);
    assert.deepEqual(beforeStart.objects, atStart.objects);
    assert.deepEqual(afterEnd.objects, atEnd.objects);
    assert.deepEqual(afterEnd.vectors, atEnd.vectors);
  });

  it("rejects a non finite time", () => {
    const compiled = compileScene(projectilePreset);
    assert.throws(() => compiled.sample(Number.NaN), ExpressionError);
    assert.throws(() => compiled.sample(Number.POSITIVE_INFINITY), ExpressionError);
  });

  it("evaluates answers at the end of the timeline", () => {
    const compiled = compileScene(projectilePreset);
    const answers = compiled.answerValues();
    const last = compiled.sample(projectilePreset.duration);
    assert.deepEqual(answers, last.answers);
  });

  it("applies live overrides without recompiling", () => {
    const compiled = compileScene(projectilePreset);
    const high = compiled.sample(1, { v0: 20 });
    const low = compiled.sample(1, { v0: 5 });
    const again = compiled.sample(1, { v0: 20 });
    assert.deepEqual(high.objects, again.objects);
    assert.notDeepEqual(high.objects, low.objects);
    assert.ok(at(high, "ball")[0] > at(low, "ball")[0]);
  });

  it("rejects an override outside the declared range", () => {
    const compiled = compileScene(projectilePreset);
    assert.throws(() => compiled.sample(1, { v0: 1e6 }), ExpressionError);
    assert.throws(() => compiled.sample(1, { v0: -1 }), ExpressionError);
  });

  it("rejects an override for an unknown variable", () => {
    const compiled = compileScene(projectilePreset);
    assert.throws(() => compiled.sample(1, { nope: 1 }), ExpressionError);
  });

  it("rejects a non finite override", () => {
    const compiled = compileScene(projectilePreset);
    assert.throws(() => compiled.sample(1, { v0: Number.NaN }), ExpressionError);
  });

  it("recomputes answers when an override changes them", () => {
    const compiled = compileScene(inclinePreset);
    const faster = compiled.answerValues({ mu: 0.05 });
    const slower = compiled.answerValues({ mu: 0.55 });
    assert.ok(faster[1] > slower[1]);
  });

  it("coerces visibility to a boolean", () => {
    const compiled = compileScene(projectilePreset);
    const beforeLanding = compiled.sample(0.5);
    const afterLanding = compiled.sample(projectilePreset.duration);
    const velocity = (sample: typeof beforeLanding) =>
      sample.vectors.find((vector) => vector.id === "velocity");
    assert.equal(velocity(beforeLanding)?.visible, true);
    assert.equal(velocity(afterLanding)?.visible, false);
  });

  it("returns vector magnitudes as the euclidean length", () => {
    const sample = compileScene(collisionPreset).sample(0);
    const velocity = sample.vectors.find((vector) => vector.id === "velocity1");
    assert.ok(velocity);
    close(velocity.magnitude, Math.hypot(...velocity.components), 1e-12);
  });
});

describe("presets match independent reference physics", () => {
  const cases: Array<{
    key: PresetKey;
    scene: SceneScript;
    reference: () => number[];
  }> = [
    {
      key: "projectile",
      scene: projectilePreset,
      reference: () => {
        const h = 5;
        const v0 = 10;
        const theta = 30;
        const vy = v0 * Math.sin(theta * DEG);
        const vx = v0 * Math.cos(theta * DEG);
        const flight = (vy + Math.sqrt(vy ** 2 + 2 * G * h)) / G;
        return [flight, vx * flight, h + (vy ** 2) / (2 * G)];
      },
    },
    {
      key: "incline",
      scene: inclinePreset,
      reference: () => {
        const theta = 30;
        const mu = 0.2;
        const m = 2;
        const accel = G * (Math.sin(theta * DEG) - mu * Math.cos(theta * DEG));
        return [0.5 * accel * 2 ** 2, accel, mu * m * G * Math.cos(theta * DEG)];
      },
    },
    {
      key: "atwood",
      scene: atwoodPreset,
      reference: () => {
        const m1 = 5;
        const m2 = 3;
        const accel = ((m1 - m2) * G) / (m1 + m2);
        return [accel, 0.5 * accel * 1 ** 2, (2 * m1 * m2 * G) / (m1 + m2)];
      },
    },
    {
      key: "orbit",
      scene: orbitPreset,
      reference: () => {
        const gm = 3.986004418e14;
        const r = 10 * 1e6;
        return [
          Math.sqrt(gm / r),
          2 * Math.PI * Math.sqrt(r ** 3 / gm),
          gm / r ** 2,
        ];
      },
    },
    {
      key: "collision",
      scene: collisionPreset,
      reference: () => {
        const m1 = 2;
        const m2 = 1;
        const v1 = 3;
        const v1After = ((m1 - m2) / (m1 + m2)) * v1;
        const v2After = ((2 * m1) / (m1 + m2)) * v1;
        const before = 0.5 * m1 * v1 ** 2;
        const after = 0.5 * m1 * v1After ** 2 + 0.5 * m2 * v2After ** 2;
        return [
          v1After,
          v2After,
          after - before,
          m1 * v1After + m2 * v2After - m1 * v1,
        ];
      },
    },
    {
      key: "fluid",
      scene: fluidPreset,
      reference: () => {
        const r1 = 0.1;
        const r2 = 0.05;
        const v1 = 2;
        const rho = 1000;
        const p1 = 101325;
        const v2 = v1 * (r1 / r2) ** 2;
        return [v2, p1 + 0.5 * rho * (v1 ** 2 - v2 ** 2), 0.5 * rho * (v2 ** 2 - v1 ** 2)];
      },
    },
    {
      key: "wave",
      scene: wavePreset,
      reference: () => {
        const amplitude = 0.35;
        const frequency = 0.5;
        const wavelength = 2;
        return [frequency * wavelength, 1 / frequency, amplitude, wavelength];
      },
    },
  ];

  it("covers all seven preset keys exactly once", () => {
    assert.equal(cases.length, 7);
    assert.deepEqual(
      cases.map((entry) => entry.key).sort(),
      Object.keys(presets).sort(),
    );
    assert.deepEqual(presetList.map((entry) => entry.key), cases.map((entry) => entry.key));
  });

  for (const { key, scene, reference } of cases) {
    it(`${key} answers equal an independent reference`, () => {
      const expected = reference();
      const compiled = compileScene(scene);
      const answers = compiled.answerValues();
      assert.equal(answers.length, expected.length);
      answers.forEach((actual, index) => {
        const tolerance = Math.max(ANSWER_ABSOLUTE_TOLERANCE, ANSWER_RELATIVE_TOLERANCE * Math.abs(expected[index]));
        assert.ok(
          Math.abs(actual - expected[index]) <= tolerance,
          `answer ${index} of ${key} was ${actual}, reference ${String(expected[index])}`,
        );
        relClose(actual, expected[index]);
      });
    });

    it(`${key} passes schema validation`, () => {
      const result = validateSceneScript(scene);
      assert.deepEqual(result.warnings.filter((warning) => warning.includes("steps start")), []);
      assert.equal(result.scene.title, scene.title);
    });

    it(`${key} passes validation against the supplied reference answers`, () => {
      const expected = reference().map((value) => ({ value, unit: "" }));
      const result = validateSceneScript(scene, expected);
      assert.ok(result.warnings.length >= 0);
    });

    it(`${key} stays finite across ${SAMPLE_COUNT} samples`, () => {
      const compiled = compileScene(scene);
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        const t = (scene.duration * index) / (SAMPLE_COUNT - 1);
        allFinite(compiled.sample(t));
      }
    });

    it(`${key} stays finite at every slider extreme`, () => {
      const compiled = compileScene(scene);
      const ranges = adjustableRanges(scene);
      const names = Object.keys(ranges);
      const low: Record<string, number> = {};
      const high: Record<string, number> = {};
      for (const name of names) {
        low[name] = ranges[name][0];
        high[name] = ranges[name][1];
      }
      for (const name of names) {
        allFinite(compiled.sample(0, { [name]: ranges[name][0] }));
        allFinite(compiled.sample(scene.duration, { [name]: ranges[name][1] }));
      }
      if (names.length > 0) {
        allFinite(compiled.sample(scene.duration / 2, low));
        allFinite(compiled.sample(scene.duration / 2, high));
        for (let index = 0; index < SAMPLE_COUNT; index += 1) {
          const t = (scene.duration * index) / (SAMPLE_COUNT - 1);
          allFinite(compiled.sample(t, low));
          allFinite(compiled.sample(t, high));
        }
      }
    });

    it(`${key} declares a running answer for every question`, () => {
      const compiled = compileScene(scene);
      const answers = compiled.sample(scene.duration).answers;
      assert.equal(answers.length, scene.answers.length);
      scene.answers.forEach((answer, index) => {
        assert.equal(typeof answer.expression, "string");
        assert.ok(answer.expression.length > 0);
        assert.ok(Number.isFinite(answers[index]));
      });
    });
  }
});

describe("preset motion is physically consistent", () => {
  it("projectile launches from the cliff and lands once", () => {
    const compiled = compileScene(projectilePreset);
    const launch = at(compiled.sample(0), "ball");
    close(launch[0], 0, 1e-12);
    close(launch[1], 5, 1e-12);

    const vy0 = 10 * Math.sin(30 * DEG);
    const flight = (vy0 + Math.sqrt(vy0 ** 2 + 2 * G * 5)) / G;

    const impact = at(compiled.sample(flight), "ball");
    close(impact[1], 0, 1e-9);
    close(impact[0], 10 * Math.cos(30 * DEG) * flight, 1e-9);

    const landed = at(compiled.sample(projectilePreset.duration), "ball");
    close(landed[0], impact[0], 1e-9);
    close(landed[1], 0, 1e-12);
  });

  it("projectile horizontal speed never changes and vertical speed is gravity plus launch", () => {
    const compiled = compileScene(projectilePreset);
    const vx = 10 * Math.cos(30 * DEG);
    for (const t of [0, 0.25, 0.5, 1, 1.5]) {
      const velocity = vectorAt(compiled.sample(t), "velocity");
      close(velocity[0], vx, 1e-9);
      close(velocity[1], 10 * Math.sin(30 * DEG) - G * t, 1e-9);
    }
  });

  it("projectile peaks at the apex height", () => {
    const compiled = compileScene(projectilePreset);
    const apexTime = (10 * Math.sin(30 * DEG)) / G;
    const apex = at(compiled.sample(apexTime), "ball");
    close(apex[1], 5 + (10 * Math.sin(30 * DEG)) ** 2 / (2 * G), 1e-9);
    const before = at(compiled.sample(apexTime - 0.05), "ball");
    const after = at(compiled.sample(apexTime + 0.05), "ball");
    assert.ok(apex[1] > before[1]);
    assert.ok(apex[1] > after[1]);
  });

  it("incline keeps the block on the ramp line and stops it when friction wins", () => {
    const compiled = compileScene(inclinePreset);
    const theta = 30 * DEG;
    for (const t of [0, 0.5, 1, 1.5, 2]) {
      const [x, y] = at(compiled.sample(t), "block");
      const travel = (x - 0.2 * Math.sin(theta)) / Math.cos(theta);
      const expectedY = (8 - travel) * Math.sin(theta) + 0.2 * Math.cos(theta);
      close(y, expectedY, 1e-9);
      assert.ok(travel >= -1e-12 && travel <= 7.4 + 1e-12, `travel ${travel} left the ramp`);
    }
    const held = compiled.sample(1, { mu: 0.6 });
    const start = at(compiled.sample(0, { mu: 0.6 }), "block");
    assert.deepEqual(at(held, "block"), start);
  });

  it("atwood moves both blocks the same distance in opposite directions", () => {
    const compiled = compileScene(atwoodPreset);
    const accel = ((5 - 3) * G) / (5 + 3);
    for (const t of [0.2, 0.5, 0.8]) {
      const heavy = at(compiled.sample(t), "heavy");
      const light = at(compiled.sample(t), "light");
      close(heavy[1], 4 - 0.5 * accel * t ** 2, 1e-9);
      close(light[1], 4 + 0.5 * accel * t ** 2, 1e-9);
    }
  });

  it("atwood stops dead at the rope limit instead of keeping a capped speed", () => {
    const compiled = compileScene(atwoodPreset);
    const accel = ((5 - 3) * G) / (5 + 3);
    const reach = Math.sqrt((2 * 1.4) / accel);
    assert.ok(reach < atwoodPreset.duration);
    const atLimit = compiled.sample(reach);
    close(at(atLimit, "light")[1], 5.4, 1e-9);
    const still = compiled.sample(atwoodPreset.duration);
    close(at(still, "light")[1], 5.4, 1e-9);
    close(vectorAt(still, "velocity2")[1], 0, 1e-12);
    close(vectorAt(still, "velocity1")[1], 0, 1e-12);
  });

  it("atwood tension sits between the two weights", () => {
    const compiled = compileScene(atwoodPreset);
    const tension = vectorAt(compiled.sample(0), "tension1")[1];
    assert.ok(tension < 5 * G, "tension must be below the heavy weight");
    assert.ok(tension > 3 * G, "tension must be above the light weight");
    relClose(tension, (2 * 5 * 3 * G) / (5 + 3));
  });

  it("atwood swaps direction when the masses swap", () => {
    const compiled = compileScene(atwoodPreset);
    const swapped = compiled.sample(0.5, { m1: 2, m2: 4 });
    const heavy = at(swapped, "heavy");
    assert.ok(heavy[1] > 4, "the lighter block on the left should rise");
  });

  it("orbit holds a fixed drawn radius and a constant angular rate", () => {
    const compiled = compileScene(orbitPreset);
    const omega = 60 / Math.sqrt((10e6) ** 3 / 3.986004418e14);
    for (let index = 0; index <= 120; index += 1) {
      const t = index;
      const [x, y, z] = at(compiled.sample(t), "satellite");
      close(x, 3.2 * Math.cos(omega * t), 1e-9);
      close(y, 3.2 * Math.sin(omega * t), 1e-9);
      close(Math.hypot(x, y), 3.2, 1e-9);
      close(z, 0, 1e-12);
    }
    const first = at(compiled.sample(0), "satellite");
    const second = at(compiled.sample(1), "satellite");
    close(second[1] - first[1], 3.2 * Math.sin(omega), 1e-9);
    close(first[0] - second[0], 3.2 * (1 - Math.cos(omega)), 1e-9);
  });

  it("orbit follows the third power law when the radius changes", () => {
    const compiled = compileScene(orbitPreset);
    const [innerSpeed, innerPeriod] = compiled.answerValues({ R: 7 });
    const [outerSpeed, outerPeriod] = compiled.answerValues({ R: 14 });
    assert.ok(outerPeriod > innerPeriod, "a higher orbit takes longer");
    assert.ok(outerSpeed < innerSpeed, "a higher orbit is slower");
    relClose(outerPeriod / innerPeriod, 2 ** 1.5, 1e-9);
    relClose(innerSpeed / outerSpeed, 2 ** 0.5, 1e-9);
  });

  it("orbit centripetal acceleration points at the planet and matches the drawn orbit", () => {
    const compiled = compileScene(orbitPreset);
    for (const t of [0, 17, 60, 119]) {
      const pull = vectorAt(compiled.sample(t), "gravityPull");
      const speed = vectorAt(compiled.sample(t), "velocity");
      const pullMagnitude = Math.hypot(...pull);
      const speedMagnitude = Math.hypot(...speed);
      relClose(pullMagnitude, speedMagnitude ** 2 / 3.2, 1e-9);
      const [x, y] = at(compiled.sample(t), "satellite");
      close(pull[0], (-x / 3.2) * pullMagnitude, 1e-9);
      close(pull[1], (-y / 3.2) * pullMagnitude, 1e-9);
    }
  });

  it("collision carts touch at the impact time and then separate", () => {
    const compiled = compileScene(collisionPreset);
    const hit = (-2.5 - -6 - 1) / 3;
    close(hit, 2.5 / 3, 1e-12);
    const atHit = compiled.sample(hit);
    const first = at(atHit, "cart1");
    const second = at(atHit, "cart2");
    close(first[0] - second[0], -1, 1e-9);

    const before = compiled.sample(hit - 0.1);
    const after = compiled.sample(hit + 0.1);
    close(second[0] - at(before, "cart1")[0], 1.3, 1e-9);
    close(at(after, "cart2")[0] - at(after, "cart1")[0], 1.3, 1e-9);
    assert.ok(at(after, "cart2")[0] > second[0], "cart 2 should move off to the right");
  });

  it("collision velocity steps to the elastic result", () => {
    const compiled = compileScene(collisionPreset);
    const hit = 2.5 / 3;
    const before = vectorAt(compiled.sample(hit - 0.01), "velocity1");
    const after = vectorAt(compiled.sample(hit + 0.01), "velocity1");
    close(before[0], 3, 1e-9);
    close(after[0], 1, 1e-9);
    close(vectorAt(compiled.sample(hit - 0.01), "velocity2")[0], 0, 1e-9);
    close(vectorAt(compiled.sample(hit + 0.01), "velocity2")[0], 4, 1e-9);
  });

  it("collision conserves momentum and kinetic energy for any mass ratio", () => {
    const compiled = compileScene(collisionPreset);
    for (const [m1, m2, v1] of [
      [2, 1, 3],
      [1, 3, 4],
      [5, 0.5, 2],
      [1, 1, 6],
    ]) {
      const answers = compiled.answerValues({ m1, m2, v1 });
      const v1After = ((m1 - m2) / (m1 + m2)) * v1;
      const v2After = ((2 * m1) / (m1 + m2)) * v1;
      relClose(answers[0], v1After);
      relClose(answers[1], v2After);
      close(answers[2], 0, 1e-9);
      close(answers[3], 0, 1e-9);
    }
  });

  it("fluid tracers are continuous and four times faster in the throat", () => {
    const compiled = compileScene(fluidPreset);
    const throatTime = 1.5 / 2;
    const crossing = at(compiled.sample(throatTime), "tracer1");
    close(crossing[0], -0.9, 1e-9);
    const justBefore = at(compiled.sample(throatTime - 1e-4), "tracer1");
    const justAfter = at(compiled.sample(throatTime + 1e-4), "tracer1");
    close(justBefore[0], -0.9, 1e-3);
    close(justAfter[0], -0.9, 1e-3);

    const wideSpeed = 2;
    const throatSpeed = 8;
    const before = at(compiled.sample(throatTime - 0.25), "tracer1");
    const after = at(compiled.sample(throatTime + 0.15), "tracer1");
    close(before[0], -0.9 - wideSpeed * 0.25, 1e-9);
    close(after[0], -0.9 + throatSpeed * 0.15, 1e-9);
  });

  it("fluid every tracer crosses the throat at the same speed", () => {
    const compiled = compileScene(fluidPreset);
    for (let index = 0; index < 5; index += 1) {
      const id = `tracer${index + 1}`;
      const start = at(compiled.sample(0), id);
      assert.ok(start[0] < -0.9, `tracer ${index + 1} should start upstream`);
      const crossing = (1.5 - index * 0.2) / 2;
      close(at(compiled.sample(crossing), id)[0], -0.9, 1e-9);
    }
  });

  it("wave markers oscillate about rest without travelling", () => {
    const compiled = compileScene(wavePreset);
    for (const index of [0, 4, 20]) {
      const x0 = at(compiled.sample(0), `node${index}`)[0];
      close(at(compiled.sample(2.5), `node${index}`)[0], x0, 1e-12);
    }
  });

  it("wave marker height is the analytic sine and never exceeds the amplitude", () => {
    const compiled = compileScene(wavePreset);
    const amplitude = 0.35;
    const frequency = 0.5;
    const wavelength = 2;
    for (const index of [0, 1, 4, 9, 17, 20]) {
      const x = index * 0.25;
      for (const t of [0, 0.37, 1.1, 2.9, 5]) {
        const [, y] = at(compiled.sample(t), `node${index}`);
        const expected =
          amplitude * Math.sin((2 * Math.PI * x) / wavelength - 2 * Math.PI * frequency * t);
        close(y, expected, 1e-9);
        assert.ok(Math.abs(y) <= amplitude + 1e-12);
      }
    }
  });

  it("wave spacing stays fixed while the pattern moves", () => {
    const compiled = compileScene(wavePreset);
    const spacing = at(compiled.sample(0.8), "node5")[0] - at(compiled.sample(0.8), "node4")[0];
    relClose(spacing, 0.25);
    relClose(spacing, 0.25, 1e-12);
  });
});

describe("validation rejects broken scenes", () => {
  const clone = (): SceneScript => structuredClone(projectilePreset) as SceneScript;

  const expectRejected = (scene: unknown, label: string) => {
    const result = checkSceneScript(scene);
    assert.equal(result.ok, false, `expected ${label} to be rejected`);
    assert.ok(result.issues.length > 0);
  };

  it("rejects a step that focuses an object which does not exist", () => {
    const scene = clone();
    scene.steps[0].focus = ["ghost"];
    expectRejected(scene, "unknown focus object");
  });

  it("rejects a step that shows a vector which does not exist", () => {
    const scene = clone();
    scene.steps[0].showVectors = ["ghostVector"];
    expectRejected(scene, "unknown showVectors id");
  });

  it("rejects a vector attached to an object which does not exist", () => {
    const scene = clone();
    scene.vectors[0].attachTo = "ghost";
    expectRejected(scene, "unknown attachTo");
  });

  it("rejects a connector that points at nothing", () => {
    const scene = clone();
    scene.connectors = [{ id: "rope", kind: "rope", from: "ball", to: "ghost" }];
    expectRejected(scene, "unknown connector endpoint");
  });

  it("rejects a connector that is neither an object nor a literal point", () => {
    const scene = clone();
    scene.connectors = [{ id: "rope", kind: "rope", from: "ball", to: "somewhere" }];
    expectRejected(scene, "non literal connector endpoint");
  });

  it("accepts a connector to a literal point", () => {
    const scene = clone();
    scene.connectors = [{ id: "rope", kind: "rope", from: "ball", to: "1,2,3" }];
    assert.equal(checkSceneScript(scene).ok, true);
  });

  it("rejects duplicate object ids", () => {
    const scene = clone();
    scene.objects[1].id = scene.objects[0].id;
    expectRejected(scene, "duplicate object id");
  });

  it("rejects duplicate variable names", () => {
    const scene = clone();
    scene.variables[1].name = scene.variables[0].name;
    expectRejected(scene, "duplicate variable name");
  });

  it("rejects a variable named after a reserved word", () => {
    const scene = clone();
    scene.variables[0].name = "sin";
    expectRejected(scene, "reserved variable name");
  });

  it("rejects a default value outside its own slider range", () => {
    const scene = clone();
    scene.variables[0].value = 999;
    expectRejected(scene, "value outside min and max");
  });

  it("rejects a step that ends after the duration", () => {
    const scene = clone();
    scene.steps[0].tEnd = projectilePreset.duration + 1;
    expectRejected(scene, "step past the duration");
  });

  it("rejects more objects than the limit allows", () => {
    const scene = clone();
    const template = scene.objects[0];
    scene.objects = Array.from({ length: SCENE_LIMITS.maxObjects + 1 }, (_, index) => ({
      ...template,
      id: `filler${index}`,
    }));
    expectRejected(scene, "too many objects");
  });

  it("rejects a duration outside the allowed window", () => {
    const scene = clone();
    scene.duration = 0.01;
    expectRejected(scene, "duration below the minimum");
    scene.duration = 500;
    expectRejected(scene, "duration above the maximum");
  });

  it("rejects an object position that is not finite at run time", () => {
    const scene = clone();
    scene.objects[1].position.x = "1/(t-3)";
    const compiled = compileScene(scene);
    assert.throws(() => compiled.sample(3), ExpressionError);
    const result = checkSceneScript(scene);
    assert.equal(result.ok, false);
  });

  it("rejects an unknown symbol in an expression", () => {
    const scene = clone();
    scene.objects[1].position.x = "notAVariable * 2";
    const result = checkSceneScript(scene);
    assert.equal(result.ok, false);
    assert.match(result.error, /symbol|notAVariable|compile/i);
  });

  it("rejects an assignment hidden in an expression", () => {
    const scene = clone();
    scene.objects[1].position.x = "v0 = 5";
    assert.equal(checkSceneScript(scene).ok, false);
  });

  it("reports a wrong reference answer instead of passing it", () => {
    const result = checkSceneScript(projectilePreset, [
      { value: 1, unit: "s" },
      { value: 14.20868188162614, unit: "m" },
      { value: 6.2742099898063195, unit: "m" },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.error, /answer check failed/);
  });

  it("rejects a reference answer list of the wrong length", () => {
    assert.throws(
      () => validateSceneScript(projectilePreset, [{ value: 1, unit: "s" }]),
      SceneValidationError,
    );
  });

  it("rejects a unit mismatch on a reference answer", () => {
    const result = checkSceneScript(projectilePreset, [
      { value: 1.6406772618373218, unit: "km" },
      { value: 14.20868188162614, unit: "m" },
      { value: 6.2742099898063195, unit: "m" },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.error, /unit mismatch/);
  });

  it("accepts every preset through the throwing validator", () => {
    for (const [key, scene] of Object.entries(presets)) {
      const result = validateSceneScript(scene);
      assert.equal(result.scene.title, scene.title, `preset ${key} failed validation`);
      assert.ok(Array.isArray(result.warnings));
    }
  });

  it("does not warn about unused sliders in any preset", () => {
    for (const [key, scene] of Object.entries(presets)) {
      const { warnings } = validateSceneScript(scene);
      const unused = warnings.filter((warning) => warning.includes("is never used"));
      assert.deepEqual(unused, [], `preset ${key} has unused variables`);
    }
  });

  it("keeps every preset inside the schema limits", () => {
    for (const [key, scene] of Object.entries(presets)) {
      const parsed = sceneScriptSchema.parse(scene);
      assert.ok(parsed.objects.length <= SCENE_LIMITS.maxObjects, key);
      assert.ok(parsed.vectors.length <= SCENE_LIMITS.maxVectors, key);
      assert.ok(parsed.steps.length <= SCENE_LIMITS.maxSteps, key);
      assert.ok(parsed.answers.length <= SCENE_LIMITS.maxAnswers, key);
      assert.ok(parsed.variables.length <= SCENE_LIMITS.maxVariables, key);
      for (const object of parsed.objects) {
        for (const value of [object.position.x, object.position.y, object.position.z]) {
          assert.ok(value.length <= SCENE_LIMITS.maxExpressionLength, `${key} ${object.id}`);
        }
      }
    }
  });
});
