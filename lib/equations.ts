import { parse, type MathNode } from "mathjs";

// Local models sometimes return calculator notation instead of LaTeX. Format
// that notation for both the notebook and film without evaluating anything.
export function equationLatex(source: string): string {
  if (source.includes("\\") || source.length > 400 || !/^[A-Za-z0-9_+\-*/^()., =]+$/.test(source)) return source;
  const sides = source.split("=");
  if (sides.length > 2 || sides.some(side => !side.trim())) return source;
  try {
    return sides.map(side => {
      const node = parse(side.trim());
      node.traverse(child => {
        if (!["ConstantNode", "SymbolNode", "OperatorNode", "FunctionNode", "ParenthesisNode"].includes(child.type)) throw new Error("Unsupported equation");
        if (child.type === "FunctionNode" && !["sqrt", "sin", "cos", "tan", "exp", "log", "abs", "min", "max", "x", "y", "v"].includes((child as any).name)) throw new Error("Unsupported function");
      });
      return node.toTex({ parenthesis: "auto", implicit: "show", handler: (child: MathNode) => {
        if (child.type !== "SymbolNode") return undefined;
        const name = (child as any).name as string;
        const subscript = /^([A-Za-z])_([A-Za-z0-9]+)$/.exec(name);
        if (subscript) return `${subscript[1]}_{\\mathrm{${subscript[2]}}}`;
        if (/^[A-Za-z]$/.test(name)) return `{${name}}`;
        return undefined;
      }});
    }).join(" = ");
  } catch { return source; }
}
