import test from "node:test";
import assert from "node:assert/strict";
import {initialNotebook,readLibrary,writeLibrary,upsertPage,renameNotebook,type Library} from "../lib/notebooks";
const manualLibrary:Library={notebooks:[{id:"physics",name:"Physics notebook",subject:"physics"},{id:"chemistry",name:"Chemistry notebook",subject:"chemistry"}],pages:[]};
test("notebook library survives a new storage reader with each question in its own notebook",()=>{
  const data=new Map<string,string>();
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
  let library=structuredClone(manualLibrary);
  library=upsertPage(library,{id:"first",notebookId:"physics",title:"A new question",status:"building",updatedAt:"2026-09-27"});
  library=upsertPage(library,{id:"second",notebookId:"chemistry",title:"A chemical question",status:"ready",updatedAt:"2026-09-27"});
  library=upsertPage(library,{id:"first",notebookId:"physics",title:"Solved question",status:"ready",updatedAt:"2026-09-28"});
  library=renameNotebook(library,"physics","  Mechanics class  ");
  writeLibrary(storage,library);
  const reopened=readLibrary({...storage});
  assert.equal(reopened.pages.length,2);
  assert.equal(reopened.pages.find(p=>p.id==="first")?.title,"Solved question");
  assert.equal(reopened.pages.find(p=>p.id==="second")?.notebookId,"chemistry");
  assert.equal(reopened.notebooks.find(n=>n.id==="physics")?.name,"Mechanics class");
  assert.throws(()=>renameNotebook(reopened,"physics","  "));
});
test("new accounts do not receive auto-created notebooks and orphan pages are rejected",()=>{
  assert.equal(readLibrary({getItem:()=>null}).notebooks.length,0);
  assert.equal(readLibrary({getItem:()=>"broken"}).notebooks.length,0);
  assert.equal(initialNotebook({notebooks:[],pages:[]},null),"");
  const library=readLibrary({getItem:()=>JSON.stringify({notebooks:[{id:"a",name:"Class",subject:"physics"}],pages:[{id:"orphan",notebookId:"missing",title:"Old question"}]})});
  assert.equal(library.pages.length,0);
});
test("a new browser opens the populated notebook even when an empty default has the same name",()=>{
  const library=structuredClone(manualLibrary);
  library.notebooks.push({id:"import-physics",name:"Physics notebook",subject:"physics"});
  library.pages.push({id:"cloud-page",notebookId:"import-physics",title:"Free fall",status:"ready",updatedAt:"2026-09-27"});
  assert.equal(initialNotebook(library,null),"import-physics");
  assert.equal(initialNotebook(library,"physics"),"import-physics");
  assert.equal(initialNotebook(library,"chemistry"),"chemistry");
});

test("JSON key order does not cause a restored page to be uploaded again",async()=>{
 const {contentSignature}=await import("../lib/notebooks");
 assert.equal(contentSignature({values:{h:20,g:9.81},scene:{title:"Fall"}}),contentSignature({scene:{title:"Fall"},values:{g:9.81,h:20}}));
 assert.notEqual(contentSignature({values:{h:20}}),contentSignature({values:{h:21}}));
});
