"use client";
import {useMemo} from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import {equationLatex} from "@/lib/equations";
export function MathResponse({text}:{text:string}) {
  const chunks=useMemo(()=>text.split(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^\n$]+?\$)/g),[text]);
  return <div className="nb-solution nb-math-response">{chunks.map((chunk,i)=>{
    const display=chunk.startsWith("$$") || chunk.startsWith("\\[");
    const math=display || chunk.startsWith("\\(") || (chunk.startsWith("$") && chunk.endsWith("$"));
    if(!math)return <span key={i}>{chunk}</span>;
    const expression=chunk.slice(display||chunk.startsWith("\\(")?2:1,display||chunk.startsWith("\\(")?-2:-1);
    try {const html=katex.renderToString(equationLatex(expression),{displayMode:display,throwOnError:false,strict:"ignore",trust:false});return <span className={display?"nb-math-block":"nb-math-inline"} key={i} dangerouslySetInnerHTML={{__html:html}}/>;}catch{return <span key={i}>{expression}</span>;}
  })}</div>;
}
