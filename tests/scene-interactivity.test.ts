import {test} from "node:test";
import assert from "node:assert/strict";
import {sceneInteractivityIssues} from "../lib/scene-interactivity";
import {presets} from "../lib/presets";

test("working preset controls change their computed experiment",()=>{
  for(const scene of Object.values(presets))assert.deepEqual(sceneInteractivityIssues(scene),[],scene.title);
});

test("dead controls and zero-multiplied controls cannot pass generation",()=>{
  const scene=structuredClone(presets.projectile);
  scene.variables.push({name:"concentration",label:"Concentration",value:.1,min:.01,max:1,step:.01,unit:"M",adjustable:true});
  assert.match(sceneInteractivityIssues(scene).join(" "),/Slider "concentration"/);
  scene.objects[0].position.x+="+concentration*0";
  assert.match(sceneInteractivityIssues(scene).join(" "),/Slider "concentration"/);
  scene.objects[0].scale={x:"1",y:"1+concentration",z:"1"};
  assert.deepEqual(sceneInteractivityIssues(scene),[]);
});

test("a control that changes a numeric answer is meaningful for a static diagram",()=>{
  const scene=structuredClone(presets.projectile);
  scene.variables.push({name:"concentration",label:"Concentration",value:.1,min:.01,max:1,step:.01,unit:"M",adjustable:true});
  scene.answers[0].expression+="+concentration";
  assert.deepEqual(sceneInteractivityIssues(scene),[]);
});
