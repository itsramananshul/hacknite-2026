import { compileScene, ExpressionError } from "./expressions";
import { sceneScriptSchema, type SceneScript } from "./schema";

export const SAMPLE_COUNT = 200;

export const ANSWER_RELATIVE_TOLERANCE = 0.02;

export const ANSWER_ABSOLUTE_TOLERANCE = 1e-8;

export interface ExpectedAnswer {
  value: number;
  unit: string;
}

export interface SceneValidationResult {
  scene: SceneScript;
  warnings: string[];
}

export type SceneCheckResult =
  | { ok: true; scene: SceneScript; warnings: string[] }
  | { ok: false; error: string; issues: string[] };

export class SceneValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "SceneValidationError";
    this.issues = issues;
  }
}

function formatIssues(error: unknown): string[] {
  const issues = (error as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues;
  if (!Array.isArray(issues)) {
    return [(error as Error).message ?? String(error)];
  }
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "scene";
    return `${path}: ${issue.message}`;
  });
}

function parseScene(input: unknown): SceneScript {
  try {
    return sceneScriptSchema.parse(input);
  } catch (error) {
    const issues = formatIssues(error);
    throw new SceneValidationError(`Scene script does not match the schema: ${issues[0]}`, issues);
  }
}

function assertSampleIsFinite(
  compiled: ReturnType<typeof compileScene>,
  t: number,
  overrides: Record<string, number> | undefined,
  where: string,
  answerLabels: readonly string[],
): void {
  let sample;
  try {
    sample = compiled.sample(t, overrides);
  } catch (error) {
    const reason = error instanceof ExpressionError ? error.message : (error as Error).message;
    throw new SceneValidationError(`${where}: ${reason}`);
  }
  const bad = (label: string, value: number): string | null =>
    Number.isFinite(value) ? null : `${label} evaluated to ${String(value)} at t = ${t}`;

  for (const object of sample.objects) {
    if(object.scale?.some(value=>!Number.isFinite(value) || value<=0 || value>200))throw new SceneValidationError(`${where}: object "${object.id}" scale must stay between 0 and 200`);
    for (const [axis, value] of object.position.entries()) {
      const problem = bad(`object "${object.id}" position.${"xyz"[axis]}`, value);
      if (problem) {
        throw new SceneValidationError(`${where}: ${problem}`);
      }
    }
    for (const [axis, value] of object.rotation.entries()) {
      const problem = bad(`object "${object.id}" rotation.${"xyz"[axis]}`, value);
      if (problem) {
        throw new SceneValidationError(`${where}: ${problem}`);
      }
    }
  }
  for (const vector of sample.vectors) {
    for (const [axis, value] of vector.components.entries()) {
      const problem = bad(`vector "${vector.id}" components.${"xyz"[axis]}`, value);
      if (problem) {
        throw new SceneValidationError(`${where}: ${problem}`);
      }
    }
    const magnitudeProblem = bad(`vector "${vector.id}" magnitude`, vector.magnitude);
    if (magnitudeProblem) {
      throw new SceneValidationError(`${where}: ${magnitudeProblem}`);
    }
  }
  const gravityProblem = bad("world.gravity", sample.gravity);
  if (gravityProblem) {
    throw new SceneValidationError(`${where}: ${gravityProblem}`);
  }
  sample.answers.forEach((value, index) => {
    const problem = bad(`answer "${answerLabels[index] ?? String(index)}"`, value);
    if (problem) {
      throw new SceneValidationError(`${where}: ${problem}`);
    }
  });
}

function compareAnswers(
  scene: SceneScript,
  computed: number[],
  expectedAnswers?: ExpectedAnswer[],
): string[] {
  const issues: string[] = [];
  scene.answers.forEach((answer, index) => {
    const expected = expectedAnswers?.[index] ?? { value: answer.value, unit: answer.unit };
    if (expectedAnswers && expectedAnswers[index] === undefined) {
      issues.push(`no expected answer was supplied for "${answer.question}"`);
      return;
    }
    if (typeof expected?.value !== "number" || !Number.isFinite(expected.value)) {
      issues.push(`expected value for "${answer.question}" is not a finite number`);
      return;
    }
    if (expectedAnswers && expected.unit && answer.unit && expected.unit !== answer.unit) {
      issues.push(
        `unit mismatch for "${answer.question}": scene says ${answer.unit}, expected ${expected.unit}`,
      );
    }
    const actual = computed[index];
    if (typeof actual !== "number" || !Number.isFinite(actual)) {
      issues.push(`"${answer.question}" did not evaluate to a finite number`);
      return;
    }
    const tolerance = Math.max(ANSWER_ABSOLUTE_TOLERANCE, ANSWER_RELATIVE_TOLERANCE * Math.abs(expected.value));
    if (Math.abs(actual - expected.value) > tolerance) {
      issues.push(
        `"${answer.question}" evaluates to ${actual} but the reference value is ${expected.value} (tolerance ${tolerance})`,
      );
    }
  });
  return issues;
}

function buildWarnings(scene: SceneScript, compiled: ReturnType<typeof compileScene>): string[] {
  const warnings: string[] = [];
  const variableNames = new Set(scene.variables.map((variable) => variable.name));
  const used = new Set<string>();

  const noteUsage = (expression: string): void => {
    for (const name of variableNames) {
      if (new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(expression)) {
        used.add(name);
      }
    }
  };

  noteUsage(scene.world.gravity);
  scene.objects.forEach((object) => {
    noteUsage(object.position.x);
    noteUsage(object.position.y);
    noteUsage(object.position.z);
    noteUsage(object.rotation.x);
    noteUsage(object.rotation.y);
    noteUsage(object.rotation.z);
    if(object.scale){noteUsage(object.scale.x);noteUsage(object.scale.y);noteUsage(object.scale.z);}
    noteUsage(object.visible);
    if ((object.shape === "sphere" || object.shape === "cylinder" || object.shape === "planet") && object.size.radius <= 0) {
      warnings.push(`object "${object.id}" is a ${object.shape} with radius 0, it will not be visible`);
    }
  });
  scene.vectors.forEach((vector) => {
    noteUsage(vector.components.x);
    noteUsage(vector.components.y);
    noteUsage(vector.components.z);
    noteUsage(vector.visible);
  });
  scene.answers.forEach((answer) => {
    noteUsage(answer.expression);
    if (/(^|[^A-Za-z0-9_])t([^A-Za-z0-9_]|$)/.test(answer.expression)) {
      warnings.push(
        `answer "${answer.question}" uses t, so it is evaluated at the end of the timeline (t = ${scene.duration})`,
      );
    }
  });

  scene.variables.forEach((variable) => {
    if (!used.has(variable.name)) {
      warnings.push(`variable "${variable.name}" is never used by any expression`);
    }
    if (!variable.adjustable) {
      return;
    }
    if (variable.step <= 0) {
      warnings.push(`adjustable variable "${variable.name}" has a step of ${variable.step}`);
    }
  });

  if (scene.answers.length === 0) {
    warnings.push("scene has no answers, the UI will show no solution values");
  }
  if (scene.steps.length === 0) {
    warnings.push("scene has no steps, the timeline narration will be empty");
  } else {
    const sorted = [...scene.steps].sort((a, b) => a.tStart - b.tStart);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first && first.tStart > 0) {
      warnings.push(`steps start at t = ${first.tStart}, the first ${first.tStart} s has no narration`);
    }
    if (last && last.tEnd < scene.duration) {
      warnings.push(`steps end at t = ${last.tEnd} but the duration is ${scene.duration}`);
    }
    sorted.forEach((step, index) => {
      const next = sorted[index + 1];
      if (next && step.tEnd > next.tStart) {
        warnings.push(`step "${step.title}" overlaps step "${next.title}"`);
      }
    });
  }

  if (scene.objects.filter((object) => object.trail).length === 0 && scene.duration > 1) {
    warnings.push("no object has a trail, motion will be harder to follow");
  }

  const gravity = compiled.sample(0).gravity;
  if (gravity < 0) {
    warnings.push(`world gravity is ${gravity}, a negative value pushes objects up`);
  }

  return warnings;
}

function extremeOverrides(scene: SceneScript): Array<{ label: string; overrides: Record<string, number> }> {
  const adjustable = scene.variables.filter((variable) => variable.adjustable);
  const cases: Array<{ label: string; overrides: Record<string, number> }> = [];
  adjustable.forEach((variable) => {
    const low = { ...{} as Record<string, number>, [variable.name]: variable.min };
    const high = { ...{} as Record<string, number>, [variable.name]: variable.max };
    cases.push({ label: `${variable.name} at its minimum`, overrides: low });
    cases.push({ label: `${variable.name} at its maximum`, overrides: high });
  });
  if (adjustable.length > 0) {
    const allLow: Record<string, number> = {};
    const allHigh: Record<string, number> = {};
    adjustable.forEach((variable) => {
      allLow[variable.name] = variable.min;
      allHigh[variable.name] = variable.max;
    });
    cases.push({ label: "every slider at its minimum", overrides: allLow });
    cases.push({ label: "every slider at its maximum", overrides: allHigh });
  }
  return cases;
}

/**
 * Parses, compiles and stress samples a scene script. Throws SceneValidationError
 * with every problem found, so a broken scene is never handed to the renderer.
 * expectedAnswers overrides the cached reference values used for the 2 percent check.
 */
export function validateSceneScript(input: unknown, expectedAnswers?: ExpectedAnswer[]): SceneValidationResult {
  const scene = parseScene(input);
  const answerLabels = scene.answers.map((answer) => answer.question);

  let compiled;
  try {
    compiled = compileScene(scene);
  } catch (error) {
    throw new SceneValidationError(`scene expressions are not usable: ${(error as Error).message}`);
  }

  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const t = (scene.duration * index) / (SAMPLE_COUNT - 1);
    assertSampleIsFinite(compiled, t, undefined, `sample ${index + 1} of ${SAMPLE_COUNT}`, answerLabels);
  }

  for (const extreme of extremeOverrides(scene)) {
    assertSampleIsFinite(compiled, scene.duration / 2, extreme.overrides, extreme.label, answerLabels);
  }

  let answers: number[];
  try {
    answers = compiled.answerValues();
  } catch (error) {
    throw new SceneValidationError(`answers could not be evaluated: ${(error as Error).message}`);
  }

  const answerIssues = compareAnswers(scene, answers, expectedAnswers);
  if (answerIssues.length > 0) {
    throw new SceneValidationError(`answer check failed: ${answerIssues.join("; ")}`, answerIssues);
  }

  if (expectedAnswers && expectedAnswers.length !== scene.answers.length) {
    throw new SceneValidationError(
      `expected ${expectedAnswers.length} answers but the scene declares ${scene.answers.length}`,
    );
  }

  return { scene, warnings: buildWarnings(scene, compiled) };
}

export function checkSceneScript(input: unknown, expectedAnswers?: ExpectedAnswer[]): SceneCheckResult {
  try {
    const result = validateSceneScript(input, expectedAnswers);
    return { ok: true, scene: result.scene, warnings: result.warnings };
  } catch (error) {
    const issues = error instanceof SceneValidationError ? error.issues : [];
    return { ok: false, error: (error as Error).message, issues: issues.length > 0 ? issues : [(error as Error).message] };
  }
}

export { compileScene } from "./expressions";
export type { CompiledExpression, CompiledScene, SceneSample } from "./expressions";
