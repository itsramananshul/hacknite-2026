import type {SolveResult} from "./gemini";

export async function readSolveStream(response:Response,onAnswers:(result:Omit<SolveResult,"scene">)=>void):Promise<SolveResult> {
  if(!response.body) throw new Error("The solution stream is unavailable.");
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let pending="",complete:SolveResult|null=null;
  const consume=(line:string)=>{
    if(!line.trim()) return;
    const event=JSON.parse(line);
    if(event.type==="answers") onAnswers(event.result);
    if(event.type==="complete") complete=event.result;
    if(event.type==="error") throw new Error(event.error||"Scene generation did not finish.");
  };
  try {
    while(true) {
      const {value,done}=await reader.read();
      pending+=decoder.decode(value,{stream:!done});
      let boundary:number;
      while((boundary=pending.indexOf("\n"))>=0){consume(pending.slice(0,boundary));pending=pending.slice(boundary+1);}
      if(done){consume(pending);break;}
    }
    if(!complete) throw new Error("The model stopped before finishing the scene.");
    return complete;
  } finally {reader.releaseLock();}
}
