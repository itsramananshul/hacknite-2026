import {test} from "node:test";
import assert from "node:assert/strict";
import {editQuestionMetadata} from "../lib/question-metadata";
import type {SavedPage} from "../lib/cloud-notebooks";
const entry={id:"question",notebookId:"physics",title:"Wave",status:"ready",updatedAt:"2026-09-27"};
const payload:SavedPage={questionPage:{id:"question",notebookId:"physics",problemText:"Original question",status:"ready",sourceImage:"data:image/png;base64,AQ==",simulations:[{id:"original",scene:{title:"Old wave"}},{id:"new",scene:{title:"New wave"}}],video:{id:"video"}},scene:{title:"Old wave"},solution:"The solution",values:{mass:8}};
test("renaming keeps the original question, all simulation versions and video",()=>{
 const changed=editQuestionMetadata(entry,payload,{title:"String experiment"});
 assert.equal(changed.entry.title,"String experiment");assert.equal(changed.payload.questionPage.title,"String experiment");
 for(const key of ["problemText","sourceImage","simulations","video"])assert.deepEqual(changed.payload.questionPage[key],payload.questionPage[key]);
 assert.deepEqual(changed.payload.scene,payload.scene);assert.equal(changed.payload.solution,payload.solution);
});
test("remove and restore keep complete content instead of deleting it",()=>{
 const removed=editQuestionMetadata(entry,payload,{removed:true});assert.ok(removed.entry.archivedAt);
 const restored=editQuestionMetadata(removed.entry,removed.payload,{removed:false});
 assert.equal(restored.entry.archivedAt,undefined);assert.deepEqual(restored.payload.questionPage.simulations,payload.questionPage.simulations);assert.equal(restored.payload.solution,payload.solution);
});
