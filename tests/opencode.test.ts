import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAnswerExpression, readSolveOutput, runOpenCodePipeline, readOpenCodeConfig } from "../lib/opencode";
import { solverProvider } from "../lib/solver";
import {presets} from '../lib/presets';
import {compileScene} from '../lib/expressions';

test('a stationary scene claiming motion is repaired before it is displayed',async()=>{
  const good=presets.projectile;
  const stationary=structuredClone(good);
  for(const object of stationary.objects) object.position={x:'0',y:'0',z:'0'};
  const values=compileScene(good).answerValues();
  let messages=0;let repair='';
  const transport:typeof fetch=async(url,init)=>{
    const path=new URL(String(url)).pathname;
    if(path==='/experimental/tool/ids') return Response.json([]);
    if(path==='/session') return Response.json({id:'stationary-test'});
    if(path.endsWith('/message')) {
      const body=JSON.parse(String(init?.body));
      const content=messages===0?{solutionText:'Projectile solution',answers:good.answers.map((a,i)=>({question:a.question,expression:String(values[i]),unit:a.unit}))}:messages===1?stationary:good;
      if(messages===2) repair=body.parts[0].text;
      messages++;
      return Response.json({info:{},parts:[{type:'text',text:JSON.stringify(content)}]});
    }
    return Response.json(true);
  };
  const result=await runOpenCodePipeline({problemText:good.problemText,image:null},{env:{},fetchImpl:transport});
  assert.ok(result.scene);assert.equal(messages,3);assert.match(repair,/position is constant|positions? is constant|position.*constant/);assert.ok(result.scene.objects.some(o=>Object.values(o.position).some(p=>/\bt\b/.test(p))));
});

test("answer numbers come from expressions, not model claims", () => {
  const output = readSolveOutput(JSON.stringify({solutionText:"Free fall",answers:[{question:"Fall time",expression:"sqrt(2*5/9.81)",unit:"s",value:999}]}));
  assert.ok(Math.abs(output.answers[0].value - 1.0096375546923044) < 1e-12);
  assert.equal(output.warnings.length, 1);
  assert.deepEqual(output.expressions, ["sqrt(2*5/9.81)"]);
});

test("constant answers reject variables, hidden time, unsafe calls, and nonfinite numbers", () => {
  for (const expression of ["t", "1 > 0 ? 3 : t", "height*2", "a=2", "import(1)", "1/0", "1>0"]) {
    assert.throws(() => evaluateAnswerExpression({question:"Result", expression,unit:"m"}));
  }
});

test("read final JSON after prose, reject malformed and empty numeric answers", () => {
  const json = JSON.stringify({solutionText:"Solved",answers:[{question:"Distance",expression:"2+3",unit:"m"}]});
  assert.equal(readSolveOutput("Explanation\n"+json).answers[0].value,5);
  assert.equal(readSolveOutput("```json\n"+json+"\n```").answers[0].value,5);
  assert.throws(() => readSolveOutput("{broken}"));
  assert.throws(() => readSolveOutput('{"solutionText":"Explain","answers":[]}'));
});

test("provider selection honors explicit Gemini and local OpenCode; remote bridge rejected", () => {
  assert.equal(solverProvider({CHALK_SOLVER:"gemini",OPENCODE_SERVER_URL:"http://127.0.0.1:4098"}),"gemini");
  assert.equal(solverProvider({CHALK_SOLVER:"opencode"}),"opencode");
  assert.equal(solverProvider({OPENCODE_SERVER_URL:"http://127.0.0.1:4098"}),"opencode");
  assert.throws(() => readOpenCodeConfig({OPENCODE_SERVER_URL:"https://example.com"}));
  assert.throws(() => readOpenCodeConfig({VERCEL:"1"}));
});

test("runtime sessions deny tools and clean up provider failures", async () => {
  const calls: {path:string;body:any}[]=[];
  const fetchImpl = (async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({path,body});
    if(path === "/experimental/tool/ids") return Response.json(["bash","read","write","task"]);
    if(path === "/session") return Response.json({id:"runtime-test"});
    if(path.endsWith("/message")) return Response.json({info:{error:{name:"APIError",data:{message:"Provider failed"}}},parts:[]});
    return Response.json(true);
  }) as typeof fetch;
  await assert.rejects(runOpenCodePipeline({problemText:"Drop a ball",image:null},{env:{},fetchImpl}));
  const creation=calls.find(x=>x.path === "/session")!;
  assert.ok(creation.body.permission.some((x:any)=>x.permission === "*" && x.action === "deny"));
  assert.deepEqual(calls.find(x=>x.path.endsWith("/message"))!.body.tools,{bash:false,read:false,write:false,task:false});
  assert.ok(calls.some(x=>x.path.endsWith("/abort")));
  assert.equal(calls.at(-1)?.path,"/session/runtime-test");
});

test("a stalled response body times out, aborts, and deletes its session", async () => {
  const paths:string[]=[];
  const fetchImpl = (async (url,init) => {
    const path=new URL(String(url)).pathname;
    paths.push(path);
    if(path === "/experimental/tool/ids") return Response.json(["bash"]);
    if(path === "/session") return Response.json({id:"timeout-test"});
    if(path.endsWith("/message")) {
      return {ok:true,status:200,text:()=>new Promise((_,reject)=>{
        init!.signal!.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
      })} as Response;
    }
    return Response.json(true);
  }) as typeof fetch;
  await assert.rejects(runOpenCodePipeline({problemText:"Drop a ball",image:null},{env:{OPENCODE_TIMEOUT_MS:"1000"},fetchImpl}),/within 1 seconds/);
  assert.ok(paths.includes("/session/timeout-test/abort"));
  assert.equal(paths.at(-1),"/session/timeout-test");
});
