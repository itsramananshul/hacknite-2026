import {test} from "node:test";
import assert from "node:assert/strict";
import {sceneFrame} from "../lib/scene-framing";
import {presets} from "../lib/presets";
import {compileScene} from "../lib/expressions";
test("every preset frames visible apparatus and trajectories at parameter extremes",()=>{
  for(const scene of Object.values(presets))for(const edge of ["min","max"] as const){
    const values=Object.fromEntries(scene.variables.map(v=>[v.name,v[edge]]));
    const frame=sceneFrame(scene,values,1.5)!;
    assert.ok(Number.isFinite(frame.distance) && frame.distance>0,scene.title);
    const sample=compileScene(scene).sample(scene.duration,values);
    for(const object of sample.objects.filter(o=>o.visible && !/^(ground|floor|base)$/i.test(o.id))){
      assert.ok(Math.hypot(...object.position.map((v,i)=>v-frame.target[i]))<=frame.radius+.001,`${scene.title}: ${object.id}`);
    }
  }
});
