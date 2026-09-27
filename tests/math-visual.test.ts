import {test} from "node:test";
import assert from "node:assert/strict";
import {buildMathVisual} from "../lib/math-visual";
import {compileScene} from "../lib/expressions";
const plan={title:"Concentrating kernel",description:"Illustration using f(x)=1-x, not a proof of the general theorem.",xMin:0,xMax:1,yMin:0,yMax:15,xLabel:"x",yLabel:"weight",parameters:[{name:"n",label:"Exponent",value:5,min:1,max:30,step:1}],curves:[{label:"Weight",expression:"n^2*x^n*(1-x)"}],steps:[{title:"Concentration",narration:"The weight concentrates near 1 as n grows.",equations:["\\lim_{n\\to\\infty} n^2/((n+1)(n+2))=1"]}]};
test("math plans create real parameter-dependent curves and retain illustrative context",()=>{
 const scene=buildMathVisual(plan);const compiled=compileScene(scene);
 assert.match(scene.problemText,/not a proof/);assert.equal(scene.world.gravity,"0");
 const first=compiled.sample(9,{n:5}).objects[0].position;
 const changed=compiled.sample(9,{n:30}).objects[0].position;
 assert.notEqual(first[1],changed[1]);assert.equal(first[0],changed[0]);
 assert.equal(scene.answers.length,0);assert.ok(scene.objects[0].trail);
});
test("math plans reject arbitrary code, unbound names and reversed domains",()=>{
 assert.throws(()=>buildMathVisual({...plan,xMax:0}),/bounds/);
 assert.throws(()=>buildMathVisual({...plan,curves:[{label:"bad",expression:"import(x)"}]}));
 assert.throws(()=>buildMathVisual({...plan,curves:[{label:"bad",expression:"unknown*x"}]}));
});
