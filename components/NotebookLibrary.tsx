"use client";
import {useState} from "react";
import type {Library,Subject} from "@/lib/notebooks";
export default function NotebookLibrary({library,activeId,cloud=false,onSelect,onRename,onCreate,onOpen}: {
  library:Library; activeId:string; cloud?:boolean; onSelect:(id:string)=>void; onRename:(id:string,name:string)=>void;
  onCreate:(name:string,subject:Subject)=>void; onOpen:(id:string)=>void;
}) {
  const active=library.notebooks.find(n=>n.id===activeId) ?? library.notebooks[0];
  const [name,setName]=useState("");
  const [subject,setSubject]=useState<Subject>("physics");
  const [renaming,setRenaming]=useState(false);
  return <section className="nb-section" aria-label="Notebook library">
    <h2 className="nb-title">Your notebooks</h2>
    <label className="nb-field" htmlFor="notebook-select">Notebook</label>
    <select id="notebook-select" className="nb-select" value={active.id} onChange={e=>{onSelect(e.target.value);setRenaming(false);}}>
      {library.notebooks.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}
    </select>
    <p className="nb-note">{active.subject} · Saved on this browser</p>
    {renaming ? <form onSubmit={e=>{e.preventDefault();if(name.trim()){onRename(active.id,name);setRenaming(false);}}}>
      <label className="nb-field" htmlFor="notebook-name">Notebook name</label>
      <input id="notebook-name" value={name} maxLength={80} onChange={e=>setName(e.target.value)} required />
      <button className="nb-btn" type="submit">Save name</button>
    </form> : <button className="nb-btn" type="button" onClick={()=>{setName(active.name);setRenaming(true);}}>Rename notebook…</button>}
    <h3 className="nb-h3">Questions</h3>
    <div className="nb-page-list">{library.pages.filter(p=>p.notebookId===active.id).map(p=><button key={p.id} type="button" className="nb-page-link" onClick={()=>onOpen(p.id)}>
      <span>{p.title}</span><small>{p.status}</small>
    </button>)}</div>
    {!library.pages.some(p=>p.notebookId===active.id) ? <p className="nb-note">No questions saved in this notebook yet. Use New page to add one.</p> : null}
    <details><summary>Create a notebook</summary><form onSubmit={e=>{e.preventDefault();if(name.trim()){onCreate(name,subject);setName("");}}}>
      <label className="nb-field" htmlFor="new-notebook-name">Name</label><input id="new-notebook-name" value={name} maxLength={80} onChange={e=>setName(e.target.value)} required />
      <label className="nb-field" htmlFor="new-notebook-subject">Subject</label><select id="new-notebook-subject" className="nb-select" value={subject} onChange={e=>setSubject(e.target.value as Subject)}>
        <option value="physics">Physics</option><option value="chemistry">Chemistry</option><option value="mathematics">Mathematics</option>
      </select><button type="submit" className="nb-btn">Create notebook</button>
    </form></details>
  </section>;
}
