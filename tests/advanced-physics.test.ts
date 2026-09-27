import { test } from "node:test";
import assert from "node:assert/strict";
import { advancedPresets, dampingDisplacement, dampingVelocity, circuitCharge, circuitCurrent, dragVelocity, dragDistance } from "../lib/advanced-presets";
import { compileExpression } from "../lib/expressions";
import { validateSceneScript } from "../lib/validate";
function evaluate(expression:string,key:keyof typeof advancedPresets,t:number) {
  const variables=advancedPresets[key].variables;
  const scope=Object.fromEntries(variables.map(v=>[v.name,v.value]));
  return Number(compileExpression(expression,variables.map(v=>v.name)).evaluate({...scope,t}));
}
test("advanced scenes validate across their slider ranges",()=>{
  for(const scene of Object.values(advancedPresets)) validateSceneScript(scene);
});
test("damped motion satisfies initial conditions and the differential equation",()=>{
  const x=(t:number)=>evaluate(dampingDisplacement("t"),"damping",t);
  const v=(t:number)=>evaluate(dampingVelocity("t"),"damping",t);
  assert.equal(x(0),1);assert.ok(v(0)===0);
  for(const t of [.2,1,2,4]) {
    const h=1e-4;const acceleration=(v(t+h)-v(t-h))/(2*h);
    assert.ok(Math.abs(acceleration+.6*v(t)+9*x(t))<1e-5);
  }
  const energy=(t:number)=>.5*v(t)**2+4.5*x(t)**2;
  assert.ok(energy(6)<energy(1));
});
test("RLC charge and discharge current satisfy Kirchhoff's equation and sign convention",()=>{
  const q=(t:number)=>evaluate(circuitCharge("t"),"circuit",t);
  const i=(t:number)=>evaluate(circuitCurrent("t"),"circuit",t);
  assert.equal(q(0),.1);assert.equal(i(0),0);
  const h=1e-5;
  for(const t of [.1,.5,1,2]) {
    const derivative=(q(t+h)-q(t-h))/(2*h);
    const currentDerivative=(i(t+h)-i(t-h))/(2*h);
    assert.ok(Math.abs(derivative+i(t))<1e-7);
    assert.ok(Math.abs(-currentDerivative-.5*i(t)+q(t)/.04)<1e-6);
  }
});
test("linear fluid drag has correct initial state, force balance, and terminal speed",()=>{
  const v=(t:number)=>evaluate(dragVelocity("t"),"drag",t);
  const s=(t:number)=>evaluate(dragDistance("t"),"drag",t);
  assert.equal(v(0),0);assert.equal(s(0),0);
  const h=1e-4;
  for(const t of [.1,1,4]) {
    assert.ok(Math.abs((v(t+h)-v(t-h))/(2*h)-(9.81-v(t)))<1e-6);
    assert.ok(Math.abs((s(t+h)-s(t-h))/(2*h)-v(t))<1e-6);
  }
  assert.ok(Math.abs(v(30)-9.81)<1e-9);
});
