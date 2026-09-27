import {test} from "node:test";
import assert from "node:assert/strict";
import {localParameterEdit} from "../lib/local-edit";
import {presets} from "../lib/presets";
import {compileScene} from "../lib/expressions";
test("explicit parameter edits recalculate answers and animated geometry without AI",()=>{
  const result=localParameterEdit(presets.projectile,"set height to 8 m")!;
  assert.equal(result.scene.variables.find(v=>v.name==="h")!.value,8);
  const compiled=compileScene(result.scene);
  assert.equal(compiled.sample(0,{}).objects.find(o=>o.id==="ball")!.position[1],8);
  assert.ok(Math.abs(result.answers[0].value-1.8847354722868295)<1e-8);
  assert.equal(localParameterEdit(presets.projectile,"double speed")!.scene.variables.find(v=>v.name==="v0")!.value,20);
  assert.equal(localParameterEdit(presets.projectile,"increase height by 2 m")!.scene.variables.find(v=>v.name==="h")!.value,7);
});
test("ambiguous, incompatible-unit and structural edits defer rather than guess",()=>{
  for(const instruction of ["add a spring","make the ramp taller","set height to 8 km","set speed to 8 and angle to 10"])
    assert.equal(localParameterEdit(presets.projectile,instruction),null);
  assert.throws(()=>localParameterEdit(presets.projectile,"set height to 999 m"),/between/);
});
