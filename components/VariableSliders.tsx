"use client";
import {useEffect,useState,type CSSProperties} from "react";
import type {SceneVariable} from "@/lib/schema";
function VariableControl({variable,current,onChange}:{variable:SceneVariable;current:number;onChange:(name:string,value:number)=>void}){
 const [draft,setDraft]=useState(String(current));
 useEffect(()=>setDraft(String(current)),[current]);
 const min=Math.min(variable.min,current),max=Math.max(variable.max,current);
 const commit=()=>{const n=Number(draft);if(draft.trim() && Number.isFinite(n) && Math.abs(n)<=1e6){onChange(variable.name,n);}else setDraft(String(current));};
 const id=`variable-${variable.name}`;
 return <div className="nb-param nb-param-exact">
   <div className="nb-param-slider"><label className="nb-param-label" htmlFor={id}>{variable.label || variable.name}</label>
   <input id={id} type="range" min={min} max={max} step={variable.step} value={current} style={{"--fill":`${max===min?0:100*(current-min)/(max-min)}%`} as CSSProperties} onChange={event=>onChange(variable.name,Number(event.target.value))}/></div>
   <input className="nb-exact-value" type="number" aria-label={`${variable.label || variable.name} exact value`} step={variable.step} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();commit();}if(event.key==="Escape")setDraft(String(current));}}/>
   <span className="nb-param-unit">{variable.unit}</span>
 </div>;
}
export default function VariableSliders({variables,values,onChange}:{variables:SceneVariable[];values:Record<string,number>;onChange:(name:string,value:number)=>void}){
 const adjustable=variables.filter(v=>v.adjustable);
 if(!adjustable.length)return <p className="nb-note">This scene fixes every quantity.</p>;
 const environment=(v:SceneVariable)=>/gravity|gravitational|temperature.*ambient/i.test(v.label) || v.name==="g";
 const wave=(v:SceneVariable)=>/frequency|amplitude|wavelength/i.test(v.label);
 const waveScene=adjustable.some(wave);
 const groups=[{name:waveScene?"String & load":"Parameters",items:adjustable.filter(v=>!environment(v)&&!wave(v))},{name:"Wave",items:adjustable.filter(v=>!environment(v)&&wave(v))},{name:"Environment",items:adjustable.filter(environment)}];
 return <div className="nb-param-groups">{groups.filter(group=>group.items.length).map(group=><section className="nb-param-group" key={group.name}><h4>{group.name}</h4><div className="nb-param-grid">{group.items.map(variable=><VariableControl key={variable.name} variable={variable} current={values[variable.name]??variable.value} onChange={onChange}/>)}</div></section>)}<p className="nb-note nb-range-help">Type a value to extend the slider range.</p></div>;
}
