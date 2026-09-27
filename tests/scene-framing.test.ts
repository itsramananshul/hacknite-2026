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

test("a lab bench does not dominate the framing of a small experiment",()=>{
 const scene=structuredClone(presets.projectile);
 scene.objects=scene.objects.filter(o=>o.id==="ball");
 scene.steps=scene.steps.map(step=>({...step,focus:["ball"]}));
 scene.objects[0].position={x:"0",y:".4",z:"0"};
 scene.objects[0].size={x:.14,y:.14,z:.14,radius:.07};
 const original=sceneFrame(scene,{},1.5)!;
 const bench=structuredClone(scene.objects[0]);bench.shape="plane";bench.position={x:"0",y:"0",z:"0"};
 bench.id="labBench";bench.size={x:80,y:.1,z:80,radius:0};
 scene.objects.push(bench);
 assert.deepEqual(sceneFrame(scene,{},1.5),original);
});
