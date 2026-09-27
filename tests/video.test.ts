import { test } from "node:test";
import assert from "node:assert/strict";
import { videoPayload, videoDirectory } from "../lib/video";
import { presets } from "../lib/presets";
test("video frames and answers use the same checked physics as the simulation",()=>{
  const payload=videoPayload(presets.damping,{A:2});
  assert.equal(payload.frames.length,241);
  assert.equal(payload.frames[0].objects[0].position[0],2);
  assert.equal(payload.frames.at(-1)?.t,6);
  assert.ok(payload.answers.every(Number.isFinite));
  assert.ok(payload.answers[2]>presets.damping.answers[2].value);
});
test("video input rejects unsafe scenes, unknown values, out-of-range values and path traversal",()=>{
  assert.throws(()=>videoPayload(presets.damping,{A:999}));
  assert.throws(()=>videoPayload(presets.damping,{hidden:1}));
  const broken=structuredClone(presets.damping);broken.objects[0].position.x="import(1)";
  assert.throws(()=>videoPayload(broken));
  assert.throws(()=>videoDirectory("../../.env.local"));
});
