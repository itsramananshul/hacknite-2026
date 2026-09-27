import {test} from "node:test";
import assert from "node:assert/strict";
import {readVideoReference} from "../lib/video-reference";
test("saved video references allow job identifiers but never paths or arbitrary URLs",()=>{
 const saved={id:"6db2ccc5-b4bd-4d89-b170-6e16bc39ca83",fingerprint:"scene-and-values"};
 assert.deepEqual(readVideoReference(saved),saved);
 for(const id of ["../session","https://example.com/file","",null])assert.equal(readVideoReference({...saved,id}),undefined);
 assert.equal(readVideoReference({...saved,fingerprint:"x".repeat(200001)}),undefined);
});
