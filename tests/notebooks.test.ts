import test from "node:test";
import assert from "node:assert/strict";
import {readLibrary,writeLibrary,upsertPage,renameNotebook} from "../lib/notebooks";
test("notebook library survives a new storage reader with each question in its own notebook",()=>{
  const data=new Map<string,string>();
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
  let library=readLibrary(storage);
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
test("invalid storage does not erase the default notebooks or introduce orphan pages",()=>{
  assert.equal(readLibrary({getItem:()=>"broken"}).notebooks.length,3);
  const library=readLibrary({getItem:()=>JSON.stringify({notebooks:[{id:"a",name:"Class",subject:"physics"}],pages:[{id:"orphan",notebookId:"missing",title:"Old question"}]})});
  assert.equal(library.pages.length,0);
});
