import {test} from "node:test";
import assert from "node:assert/strict";
import {equationLatex} from "../lib/equations";
import katex from "katex";

test("calculator equations typeset roots, fractions and complete subscripts",()=>{
  const result=equationLatex("t_fall = sqrt(2*h/g)");
  assert.match(result,/t_\{\\mathrm\{fall\}\}/);
  assert.match(result,/\\sqrt\{\\frac/);
  assert.ok(!result.includes("sqrt("));
  assert.doesNotThrow(()=>katex.renderToString(result,{throwOnError:true}));
  assert.ok(!equationLatex("y(t) = h - (1/2)gt^2").includes("~"));
});
test("authored LaTeX and unsupported input remain unchanged",()=>{
  for(const text of ["\\frac{a}{b}","x.__proto__","x = import(1)","x = 2; y = 3"]) assert.equal(equationLatex(text),text);
});
