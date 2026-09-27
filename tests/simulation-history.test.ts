import {test} from "node:test";
import assert from "node:assert/strict";
import {keepSimulation} from "../lib/simulation-history";
import {sceneShareLink} from "../lib/share-link";
import {presets} from "../lib/presets";
import {decompressFromEncodedURIComponent} from "lz-string";
test("regeneration preserves earlier scene, values and video after JSON persistence",()=>{
 const first=keepSimulation([],presets.projectile,{h:5},"original",{id:"old",fingerprint:"one"});
 const second=keepSimulation(first.versions,presets.wave,{L:2},"new");
 const restored=JSON.parse(JSON.stringify(second.versions));
 assert.equal(restored.length,2);assert.deepEqual(restored[0].scene,presets.projectile);assert.equal(restored[0].video.id,"old");
 assert.equal(keepSimulation(second.versions,presets.projectile,{h:5},"original").id,first.id);
});
test("shared scene URLs remove private page IDs and preserve the exact embedded scene",()=>{
 const url=new URL(sceneShareLink("http://localhost:3000/?page=other-private-page#nb-variables",presets.wave));
 assert.equal(url.search,"");assert.deepEqual(JSON.parse(decompressFromEncodedURIComponent(new URLSearchParams(url.hash.slice(1)).get("scene")!)!),presets.wave);
});
