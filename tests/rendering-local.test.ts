import {test} from 'node:test';import assert from 'node:assert/strict';
import {placeLabel,type LabelBox} from '../lib/label-layout';
import {normalizeLocalScene,parseLocalScene,runOllamaPipeline,ollamaJsonSchema} from '../lib/ollama';
test('Ollama camera tuple grammar keeps numeric coordinates and fixed length',()=>{
  const input={type:'array',items:[{type:'number'},{type:'number'},{type:'number'}],minItems:3,maxItems:3};
  assert.deepEqual(ollamaJsonSchema(input),{type:'array',items:{type:'number'},minItems:3,maxItems:3});
  assert.equal(input.items.length,3);
  assert.deepEqual(ollamaJsonSchema({type:'array',prefixItems:input.items,items:false,minItems:3,maxItems:3}),{type:'array',items:{type:'number'},minItems:3,maxItems:3});
});
test('dense captions stay separate and inside the viewport',()=>{const placed:LabelBox[]=[];for(let i=0;i<24;i++)placeLabel(.9,.9,.10,.07,placed);for(let i=0;i<placed.length;i++){const p=placed[i];assert.ok(p.left>=-.951&&p.right<=.951&&p.bottom>=-.921&&p.top<=.851);for(let j=0;j<i;j++){const q=placed[j];assert.ok(!(p.left<q.right&&p.right>q.left&&p.bottom<q.top&&p.top>q.bottom));}}});
test('an overcrowded viewport hides surplus captions instead of stacking them',()=>{const placed:LabelBox[]=[];for(let i=0;i<120;i++){const result=placeLabel(0,0,.4,.3,placed);if(!result.visible)assert.ok(placed.length<120);}for(let i=0;i<placed.length;i++)for(let j=0;j<i;j++){const p=placed[i],q=placed[j];assert.ok(!(p.left<q.right&&p.right>q.left&&p.bottom<q.top&&p.top>q.bottom));}});
test('local scalar cleanup preserves expressions and does not evaluate strings',()=>{const source={duration:'3',variables:[{value:'2',min:'x',max:'1/0'}],loop:'false',answers:[{value:'9.81',expression:'tFall'}]};const r:any=normalizeLocalScene(source);assert.equal(r.duration,3);assert.equal(r.loop,false);assert.equal(r.variables[0].value,2);assert.equal(r.variables[0].min,'x');assert.equal(r.variables[0].max,'1/0');assert.equal(r.answers[0].expression,'tFall');assert.equal(source.duration,'3');});
test('offline mode rejects remote servers, cloud models and hosted execution',async()=>{const req={problemText:'A ball falls',image:null};for(const env of [{OLLAMA_SERVER_URL:'https://example.com'},{OLLAMA_MODEL:'kimi-k2.5:cloud'},{VERCEL:'1'}])await assert.rejects(runOllamaPipeline(req,env));});
test('local expression quoting repairs JSON without performing arithmetic',()=>{
  const result:any=parseLocalScene('```json\n{"position":{"x":0,"y":-g * t,"z":0},"visible":true}\n```');
  assert.equal(result.position.y,'-g * t');assert.equal(result.position.x,0);assert.equal(result.visible,true);
  assert.throws(()=>parseLocalScene('{"position":{"y":process.exit(0);}}'));
});
