import {test} from "node:test";
import assert from "node:assert/strict";
import {presets} from "../lib/presets";
import {withParameterRanges} from "../lib/parameter-ranges";
import {videoPayload} from "../lib/video";
test("exact values extend saved and video domains without mutating preset defaults",()=>{
 const scene=presets.projectile,variable=scene.variables.find(v=>v.adjustable)!;
 const value=variable.max+variable.step;
 const expanded=withParameterRanges(scene,{[variable.name]:value});
 assert.equal(expanded.variables.find(v=>v.name===variable.name)!.max,value);
 assert.equal(variable.max,scene.variables.find(v=>v.name===variable.name)!.max);
 assert.equal(expanded.variables.find(v=>v.name===variable.name)!.value,variable.value);
 assert.doesNotThrow(()=>videoPayload(expanded,{[variable.name]:value},""));
 assert.equal(withParameterRanges(scene,{[variable.name]:Infinity}).variables.find(v=>v.name===variable.name)!.max,variable.max);
});
