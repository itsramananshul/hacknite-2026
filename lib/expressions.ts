import { parse, type EvalFunction, type MathNode } from "mathjs";
import {
  RESERVED_IDENTIFIERS,
  SCENE_LIMITS,
  sceneScriptSchema,
  type SceneExpression,
  type ScenePointExpression,
  type SceneScript,
} from "./schema";

export const TIME_SYMBOL = "t";

export const ALLOWED_CONSTANTS: readonly string[] = ["pi", "e"];

export const ALLOWED_FUNCTIONS: readonly string[] = ["sin", "cos", "tan", "sqrt", "abs", "min", "max", "exp", "log", "log10"];

export const EXPRESSION_LIMITS = {
  maxNodes: 300,
  maxDepth: 32,
  maxFunctionArgs: 32,
} as const;

const SINGLE_ARG_FUNCTIONS = new Set(["sin", "cos", "tan", "sqrt", "abs", "exp", "log", "log10"]);
const VARIADIC_FUNCTIONS = new Set(["min", "max"]);
const ALLOWED_OPERATORS = new Set(["+", "-", "*", "/", "^", "%", "<", "<=", ">", ">=", "==", "!="]);
const BINARY_OPERATORS = new Set(["+", "-", "*", "/", "^", "%", "<", "<=", ">", ">=", "==", "!="]);
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

export interface CompiledExpression {
  readonly source: string;
  readonly names: readonly string[];
  evaluate(scope: Record<string, number>): number | boolean;
}

export interface SceneSampleObject {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  visible: boolean;
}

export interface SceneSampleVector {
  id: string;
  components: [number, number, number];
  visible: boolean;
  magnitude: number;
}

/**
 * One frame of a compiled scene. Positions, rotations and vector components are in
 * scene units, gravity is the positive downward magnitude and visibility is coerced
 * (a number is visible when it is not zero, a boolean is used directly).
 */
export interface SceneSample {
  objects: SceneSampleObject[];
  vectors: SceneSampleVector[];
  gravity: number;
  answers: number[];
}

/**
 * Frozen renderer contract. `sample` clamps t into [0, duration] and accepts
 * overrides for adjustable variables, both without recompiling. Answers are
 * evaluated at t = duration, so answer expressions must not depend on t.
 */
export interface CompiledScene {
  sample(t: number, overrides?: Record<string, number>): SceneSample;
  answerValues(overrides?: Record<string, number>): number[];
}

interface NodeLike {
  type: string;
  value?: unknown;
  name?: string;
  op?: string;
  implicit?: boolean;
  isPercentage?: boolean;
  fn?: { name?: string };
  args?: NodeLike[];
  content?: NodeLike;
  condition?: NodeLike;
  trueExpr?: NodeLike;
  falseExpr?: NodeLike;
}

function describeNode(node: NodeLike): string {
  return node.toString ? node.toString() : node.type;
}

function inspectNode(node: NodeLike, names: ReadonlySet<string>, depth: number, counter: { nodes: number }): void {
  if (depth > EXPRESSION_LIMITS.maxDepth) {
    throw new ExpressionError(`expression nests deeper than ${EXPRESSION_LIMITS.maxDepth} levels`);
  }
  counter.nodes += 1;
  if (counter.nodes > EXPRESSION_LIMITS.maxNodes) {
    throw new ExpressionError(`expression has more than ${EXPRESSION_LIMITS.maxNodes} nodes`);
  }

  switch (node.type) {
    case "ConstantNode": {
      const value = node.value;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new ExpressionError(`numeric literal ${String(value)} is not finite`);
        }
        return;
      }
      if (typeof value === "boolean") {
        return;
      }
      throw new ExpressionError("only numeric and boolean literals are allowed in expressions");
    }
    case "SymbolNode": {
      if (typeof node.name !== "string" || !names.has(node.name)) {
        const hint =
          typeof node.name === "string" && RESERVED_IDENTIFIERS.includes(node.name) && !names.has(node.name)
            ? `, "${node.name}" is reserved by the expression language`
            : "";
        throw new ExpressionError(`symbol "${String(node.name)}" is not available in this expression${hint}`);
      }
      return;
    }
    case "ParenthesisNode": {
      if (!node.content) {
        throw new ExpressionError("empty parentheses are not allowed");
      }
      inspectNode(node.content, names, depth + 1, counter);
      return;
    }
    case "OperatorNode": {
      if (node.isPercentage === true) {
        throw new ExpressionError("the percent operator is not allowed, write the value out in full");
      }
      const op = typeof node.op === "string" ? node.op : "";
      if (!ALLOWED_OPERATORS.has(op)) {
        throw new ExpressionError(`operator "${op || node.type}" is not allowed`);
      }
      if (node.implicit === true && op !== "*") {
        throw new ExpressionError(`implicit operator "${op}" is not allowed, use an explicit symbol`);
      }
      const args = node.args ?? [];
      if (args.length === 1 && (op === "+" || op === "-")) {
        inspectNode(args[0], names, depth + 1, counter);
        return;
      }
      if (args.length !== 2) {
        throw new ExpressionError(`operator "${op}" needs two operands`);
      }
      if (args.length > 2 && (op === "+" || op === "*")) {
        throw new ExpressionError(`operator "${op}" takes exactly two operands, add parentheses`);
      }
      args.forEach((arg) => inspectNode(arg, names, depth + 1, counter));
      return;
    }
    case "FunctionNode": {
      const fnName = typeof node.fn?.name === "string" ? node.fn.name : "";
      if (!ALLOWED_FUNCTIONS.includes(fnName)) {
        throw new ExpressionError(`function "${fnName || "unknown"}" is not allowed, use one of ${ALLOWED_FUNCTIONS.join(", ")}`);
      }
      const args = node.args ?? [];
      if (SINGLE_ARG_FUNCTIONS.has(fnName) && args.length !== 1) {
        throw new ExpressionError(`function ${fnName} takes exactly one argument`);
      }
      if (VARIADIC_FUNCTIONS.has(fnName) && (args.length < 1 || args.length > EXPRESSION_LIMITS.maxFunctionArgs)) {
        throw new ExpressionError(`function ${fnName} takes between 1 and ${EXPRESSION_LIMITS.maxFunctionArgs} arguments`);
      }
      args.forEach((arg) => inspectNode(arg, names, depth + 1, counter));
      return;
    }
    case "ConditionalNode": {
      if (!node.condition || !node.trueExpr || !node.falseExpr) {
        throw new ExpressionError("a ternary needs a condition and both branches");
      }
      inspectNode(node.condition, names, depth + 1, counter);
      inspectNode(node.trueExpr, names, depth + 1, counter);
      inspectNode(node.falseExpr, names, depth + 1, counter);
      return;
    }
    default:
      throw new ExpressionError(`${node.type} is not allowed in a scene expression (${describeNode(node)})`);
  }
}

export function compileExpression(expression: string, variableNames: readonly string[] = []): CompiledExpression {
  if (typeof expression !== "string") {
    throw new ExpressionError("expression must be a string");
  }
  const source = expression.trim();
  if (source.length === 0) {
    throw new ExpressionError("expression must not be empty");
  }
  if (source.length > SCENE_LIMITS.maxExpressionLength) {
    throw new ExpressionError(
      `expression must be at most ${SCENE_LIMITS.maxExpressionLength} characters, got ${source.length}`,
    );
  }

  const names = new Set<string>([TIME_SYMBOL, ...ALLOWED_CONSTANTS]);
  for (const name of variableNames) {
    if (typeof name !== "string" || !IDENTIFIER_PATTERN.test(name)) {
      throw new ExpressionError(`"${String(name)}" is not a usable variable name`);
    }
    if (RESERVED_IDENTIFIERS.includes(name)) {
      throw new ExpressionError(`variable name "${name}" is reserved by the expression language`);
    }
    names.add(name);
  }

  let parsed: MathNode;
  try {
    parsed = parse(source);
  } catch (error) {
    throw new ExpressionError(`cannot parse "${source}": ${(error as Error).message}`);
  }

  inspectNode(parsed as unknown as NodeLike, names, 1, { nodes: 0 });

  let compiled: EvalFunction;
  try {
    compiled = parsed.compile();
  } catch (error) {
    throw new ExpressionError(`cannot compile "${source}": ${(error as Error).message}`);
  }

  return {
    source,
    names: [...names],
    evaluate(scope: Record<string, number>): number | boolean {
      const frame = new Map<string, number>();
      if (scope !== null && scope !== undefined) {
        for (const key of Object.keys(scope)) {
          if (!names.has(key)) {
            throw new ExpressionError(`scope key "${key}" is not a symbol of this expression`);
          }
          const value = scope[key];
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new ExpressionError(`value for "${key}" must be a finite number`);
          }
          frame.set(key, value);
        }
      }
      let result: unknown;
      try {
        result = compiled.evaluate(frame);
      } catch (error) {
        throw new ExpressionError(`"${source}" could not be evaluated: ${(error as Error).message}`);
      }
      if (typeof result === "boolean") {
        return result;
      }
      if (typeof result === "number" && Number.isFinite(result)) {
        return result;
      }
      throw new ExpressionError(`"${source}" produced ${String(result)}, which is not a finite number`);
    },
  };
}

function compilePoint(point: ScenePointExpression, variableNames: readonly string[], label: string) {
  return {
    x: compileExpression(point.x, variableNames),
    y: compileExpression(point.y, variableNames),
    z: compileExpression(point.z, variableNames),
    label,
  };
}

function requireNumber(value: number | boolean, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ExpressionError(`${label} must evaluate to a finite number`);
  }
  return value;
}

function requireVisible(value: number | boolean, label: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  throw new ExpressionError(`${label} must evaluate to a finite number or a boolean`);
}

export function compileScene(input: SceneScript): CompiledScene {
  const scene = sceneScriptSchema.parse(input);
  const variableNames = scene.variables.map((variable) => variable.name);
  const ranges = new Map<string, { min: number; max: number }>();
  for (const variable of scene.variables) {
    ranges.set(variable.name, { min: variable.min, max: variable.max });
  }

  const gravityExpression = compileExpression(scene.world.gravity, variableNames);
  const objects = scene.objects.map((object) => ({
    id: object.id,
    position: compilePoint(object.position, variableNames, `object "${object.id}" position`),
    rotation: compilePoint(object.rotation, variableNames, `object "${object.id}" rotation`),
    visible: compileExpression(object.visible, variableNames),
  }));
  const vectors = scene.vectors.map((vector) => ({
    id: vector.id,
    components: compilePoint(vector.components, variableNames, `vector "${vector.id}" components`),
    visible: compileExpression(vector.visible, variableNames),
  }));
  const answers = scene.answers.map((answer) => compileExpression(answer.expression, variableNames));

  const duration = scene.duration;

  function buildScope(t: number, overrides?: Record<string, number>): Record<string, number> {
    if (typeof t !== "number" || !Number.isFinite(t)) {
      throw new ExpressionError(`time must be a finite number, got ${String(t)}`);
    }
    const clamped = Math.min(Math.max(t, 0), duration);
    const scope: Record<string, number> = {};
    for (const variable of scene.variables) {
      scope[variable.name] = variable.value;
    }
    scope[TIME_SYMBOL] = clamped;
    if (overrides !== null && overrides !== undefined) {
      for (const key of Object.keys(overrides)) {
        const range = ranges.get(key);
        if (!range) {
          throw new ExpressionError(`"${key}" is not an adjustable variable of this scene`);
        }
        const value = overrides[key];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new ExpressionError(`override "${key}" must be a finite number`);
        }
        if (value < range.min || value > range.max) {
          throw new ExpressionError(
            `override "${key}" = ${value} is outside the allowed range [${range.min}, ${range.max}]`,
          );
        }
        scope[key] = value;
      }
    }
    return scope;
  }

  function readAnswers(scope: Record<string, number>): number[] {
    return answers.map((answer, index) =>
      requireNumber(answer.evaluate(scope), `answer "${scene.answers[index].question}"`),
    );
  }

  const compiled: CompiledScene = {
    sample(t: number, overrides?: Record<string, number>): SceneSample {
      const scope = buildScope(t, overrides);
      const sampledObjects: SceneSampleObject[] = objects.map((object) => ({
        id: object.id,
        position: [
          requireNumber(object.position.x.evaluate(scope), `object "${object.id}" position.x`),
          requireNumber(object.position.y.evaluate(scope), `object "${object.id}" position.y`),
          requireNumber(object.position.z.evaluate(scope), `object "${object.id}" position.z`),
        ],
        rotation: [
          requireNumber(object.rotation.x.evaluate(scope), `object "${object.id}" rotation.x`),
          requireNumber(object.rotation.y.evaluate(scope), `object "${object.id}" rotation.y`),
          requireNumber(object.rotation.z.evaluate(scope), `object "${object.id}" rotation.z`),
        ],
        visible: requireVisible(object.visible.evaluate(scope), `object "${object.id}" visible`),
      }));
      const sampledVectors: SceneSampleVector[] = vectors.map((vector) => {
        const components: [number, number, number] = [
          requireNumber(vector.components.x.evaluate(scope), `vector "${vector.id}" components.x`),
          requireNumber(vector.components.y.evaluate(scope), `vector "${vector.id}" components.y`),
          requireNumber(vector.components.z.evaluate(scope), `vector "${vector.id}" components.z`),
        ];
        return {
          id: vector.id,
          components,
          visible: requireVisible(vector.visible.evaluate(scope), `vector "${vector.id}" visible`),
          magnitude: Math.hypot(components[0], components[1], components[2]),
        };
      });
      return {
        objects: sampledObjects,
        vectors: sampledVectors,
        gravity: requireNumber(gravityExpression.evaluate(scope), "world.gravity"),
        answers: readAnswers(scope),
      };
    },
    answerValues(overrides?: Record<string, number>): number[] {
      return readAnswers(buildScope(duration, overrides));
    },
  };

  return compiled;
}

export type { SceneExpression };
