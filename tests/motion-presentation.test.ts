import {test} from "node:test";
import assert from "node:assert/strict";
import {motionPresentation,captionObjectIds} from "../lib/motion-presentation";
import {compileScene} from "../lib/expressions";
import {presets,presetList} from "../lib/presets";
import {videoPayload} from "../lib/video";

test("60 Hz string is readable without altering its physical frequency or answers",()=>{
  const scene=structuredClone(presets.wave);
  const f=scene.variables.find(v=>v.name==="f")!;f.value=60;f.max=100;
  const answers=compileScene(scene).answerValues();scene.answers.forEach((a,i)=>a.value=answers[i]);
  const view=motionPresentation(scene);
  assert.ok(Math.abs(view.frequencyHz-60)<1e-6);
  assert.ok(Math.abs(view.rate-1/30)<1e-8);
  assert.equal(view.scene.variables.find(v=>v.name==="f")?.value,60);
  assert.deepEqual(compileScene(view.scene).answerValues(),compileScene(scene).answerValues());
  const compiled=compileScene(view.scene);
  const a=compiled.sample(0).objects;
  const b=compiled.sample(.5).objects;
  for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i].position[1]-b[i].position[1])<1e-8,"displayed wave completes two smooth cycles per second");
  const payload=videoPayload(scene);
  assert.equal(payload.pointIds.length,21);
  assert.deepEqual(payload.answers,compileScene(scene).answerValues());
  assert.deepEqual(payload.frames[60].objects,compiled.sample(scene.duration/4).objects);
});
test("normal presets keep their original physical timing",()=>{
  for(const entry of presetList) {
    const scene=presets[entry.key];
    const view=motionPresentation(scene);
    assert.equal(view.rate,1,scene.title);
    assert.deepEqual(compileScene(view.scene).sample(.25),compileScene(scene).sample(.25));
  }
});
test("particle labels use letters and repeated descriptive captions do not flood the scene",()=>{
  const scene=structuredClone(presets.wave);
  for(const o of scene.objects)o.label="String element";
  const view=motionPresentation(scene);
  assert.equal(view.scene.objects.find(o=>o.id===view.pointIds[0])?.label,"A");assert.equal(view.scene.objects.find(o=>o.id===view.pointIds[1])?.label,"B");
  const ids=captionObjectIds(scene,[scene.objects[3].id]);
  assert.deepEqual([...ids],[scene.objects[3].id]);
});
