import {test} from "node:test";
import assert from "node:assert/strict";
import {readVideoReference} from "../lib/video-reference";
test("saved video references allow job identifiers but never paths or arbitrary URLs",()=>{
 const saved={id:"6db2ccc5-b4bd-4d89-b170-6e16bc39ca83",fingerprint:"scene-and-values"};
 assert.deepEqual(readVideoReference(saved),saved);
 for(const id of ["../session","https://example.com/file","",null])assert.equal(readVideoReference({...saved,id}),undefined);
 assert.equal(readVideoReference({...saved,fingerprint:"x".repeat(200001)}),undefined);
});

import {removeSavedVideo} from '../lib/video-reference';
test('deleting one video preserves the question, solutions and every simulation',()=>{
 const first={id:'first',fingerprint:'a'},second={id:'second',fingerprint:'b'};
 const page={problemText:'Original question',solution:'Original solution',video:second,videoHistory:[first,second],simulations:[{id:'old',scene:{objects:[1]},video:first},{id:'new',scene:{objects:[2]},video:second}]};
 const result=removeSavedVideo(page,'second');
 assert.equal(result.problemText,page.problemText);assert.equal(result.solution,page.solution);
 assert.deepEqual(result.videoHistory,[first]);assert.deepEqual(result.video,first);
 assert.deepEqual(result.simulations?.map(v=>v.scene),page.simulations.map(v=>v.scene));
 assert.equal(result.simulations?.[0].video,first);assert.equal(result.simulations?.[1].video,undefined);
 assert.deepEqual(page.videoHistory,[first,second]);
});
