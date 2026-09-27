import test from "node:test";
import assert from "node:assert/strict";
import {parseSolveRequest} from "../lib/gemini";
import {evaluateAnswerExpression} from "../lib/opencode";
import {compileExpression} from "../lib/expressions";
test("chemistry and mathematics requests retain their notebook subject",()=>{
  assert.equal(parseSolveRequest({problemText:"Find pH",subject:"chemistry"}).subject,"chemistry");
  assert.equal(parseSolveRequest({problemText:"Find an integral",subject:"mathematics"}).subject,"mathematics");
  assert.throws(()=>parseSolveRequest({problemText:"Question",subject:"unknown"}));
});
test("checked logarithms support pH, buffers and equilibrium without allowing arbitrary calls",()=>{
  assert.equal(evaluateAnswerExpression({question:"pH",expression:"-log10(0.01)",unit:"1"}).value,2);
  const buffer=evaluateAnswerExpression({question:"Buffer pH",expression:"4.76+log10(0.15/0.10)",unit:"1"});
  assert.ok(Math.abs(buffer.value-4.936091259)<1e-9);
  assert.equal(compileExpression("log(exp(2))").evaluate({}),2);
  assert.throws(()=>compileExpression("log10(import('os'))"));
  assert.throws(()=>evaluateAnswerExpression({question:"Invalid",expression:"log(-1)",unit:"1"}));
});
