"use client";
import {useState} from "react";
import type {Library,Subject} from "@/lib/notebooks";
export default function NotebookLibrary({library,activeId,cloud=false,onSelect,onRename,onCreate,onOpen,onDelete,onRenameQuestion,onArchiveQuestion}: {
  library:Library; activeId:string; cloud?:boolean; onSelect:(id:string)=>void; onRename:(id:string,name:string)=>void;
  onCreate:(name:string,subject:Subject)=>void; onOpen:(id:string)=>void; onDelete:(id:string)=>Promise<void>;
  onRenameQuestion:(id:string,name:string)=>void; onArchiveQuestion:(id:string,removed:boolean)=>void;
}) {
  const active=library.notebooks.find(n=>n.id===activeId) ?? library.notebooks[0];
  const [name,setName]=useState("");
  const [subject,setSubject]=useState<Subject>("physics");
  const [renaming,setRenaming]=useState<string|null>(null);
  const [deleting,setDeleting]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [creating,setCreating]=useState(!library.notebooks.length);
  const [questionEdit,setQuestionEdit]=useState<{id:string;name:string}|null>(null);
  const subjects: {id:Subject;name:string;detail:string}[]=[{id:"physics",name:"Physics",detail:"Motion, forces and fields"},{id:"chemistry",name:"Chemistry",detail:"Molecules and reactions"},{id:"mathematics",name:"Maths",detail:"Functions and calculus"}];
  return <section className="nb-section" aria-label="Notebook library">
    <div className="nb-library-heading"><h2 className="nb-h3">Your notebooks</h2>{active && !creating ? <button type="button" className="nb-btn nb-btn-quiet" onClick={()=>{setCreating(true);setRenaming(null);setName("");}}>+ New notebook</button> : null}</div>
    {creating ? <form className="nb-create-notebook" onSubmit={e=>{e.preventDefault();if(name.trim()){onCreate(name.trim(),subject);setName("");setCreating(false);}}}>
      <div className="nb-create-intro"><span className="nb-eyebrow">YOUR WORKSPACE</span><h3 className="nb-h3">{active ? "Create a notebook" : "Start your first notebook"}</h3><p className="nb-note">Give your questions a home. Choose a name and what you’ll study.</p></div>
      <div><label className="nb-field" htmlFor="new-notebook-name">Notebook name</label><input className="nb-input" id="new-notebook-name" placeholder="e.g. Mechanics class" value={name} maxLength={80} onChange={e=>setName(e.target.value)} required autoFocus /></div>
      <fieldset className="nb-subject-choice"><legend className="nb-field">Subject</legend>{subjects.map(s=><label key={s.id} className="nb-subject-option"><input type="radio" name="notebook-subject" value={s.id} checked={subject===s.id} onChange={()=>setSubject(s.id)}/><span><strong>{s.name}</strong><small>{s.detail}</small></span></label>)}</fieldset>
      <div className="nb-create-actions">{active ? <button type="button" className="nb-btn nb-btn-quiet" onClick={()=>setCreating(false)}>Cancel</button> : null}<button type="submit" className="nb-btn nb-btn-primary">Create notebook</button></div>
    </form> : null}
    {active && !creating ? <><p className="nb-note">{cloud ? "Your account workspace" : "Saved on this browser"}</p>
    <nav className="nb-library-tree" aria-label="Your notebooks">
      {library.notebooks.map(notebook=>{
        const pages=library.pages.filter(p=>p.notebookId===notebook.id && !p.archivedAt);
        const removed=library.pages.filter(p=>p.notebookId===notebook.id && p.archivedAt);
        const selected=notebook.id===active.id;
        return <div key={notebook.id} className="nb-library-book">
          <div className="nb-book-heading"><button type="button" className="nb-book-row" aria-expanded={selected} aria-controls={`book-pages-${notebook.id}`} onClick={()=>{onSelect(notebook.id);setRenaming(null);}}>
            <span className="nb-book-chevron" aria-hidden="true">{selected ? "⌄" : "›"}</span>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 3h10a2 2 0 0 1 2 2v12H5a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2Zm2 0v14M9 7h4M9 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            <span>{notebook.name}</span><small aria-label={`${pages.length} questions`}>{pages.length}</small>
          </button><details className="nb-book-menu"><summary aria-label={`Actions for ${notebook.name}`}>•••</summary><div><button type="button" onClick={()=>{setName(notebook.name);setRenaming(notebook.id);setDeleting(null);}}>Rename…</button><button type="button" onClick={()=>{setDeleting(notebook.id);setRenaming(null);setError(null);}}>Delete…</button></div></details></div>
          {renaming===notebook.id ? <form className="nb-book-edit" onSubmit={e=>{e.preventDefault();if(name.trim()){onRename(notebook.id,name);setRenaming(null);}}}><label className="nb-field" htmlFor="notebook-name">Notebook name</label><input className="nb-input" id="notebook-name" value={name} maxLength={80} onChange={e=>setName(e.target.value)} required autoFocus/><div className="nb-create-actions"><button type="button" className="nb-btn nb-btn-quiet" onClick={()=>setRenaming(null)}>Cancel</button><button type="submit" className="nb-btn nb-btn-primary">Save name</button></div></form> : null}
          {deleting===notebook.id ? <div className="nb-book-edit" role="alert"><strong>Delete {notebook.name}?</strong><p className="nb-note">This permanently deletes this notebook and its {pages.length} questions, including saved simulations. This cannot be undone.</p>{error ? <p role="alert">{error}</p> : null}<div className="nb-create-actions"><button type="button" className="nb-btn" disabled={busy} onClick={()=>setDeleting(null)}>Cancel</button><button type="button" className="nb-btn nb-delete" disabled={busy} onClick={async()=>{setBusy(true);try{await onDelete(notebook.id);setDeleting(null);}catch(e){setError(e instanceof Error?e.message:"Could not delete this notebook.");}finally{setBusy(false);}}}>{busy?"Deleting…":"Delete notebook"}</button></div></div> : null}
          <div id={`book-pages-${notebook.id}`} hidden={!selected} className="nb-book-pages">
            {pages.map(page=><div key={page.id}>
              <div className="nb-book-heading"><button type="button" className="nb-page-link" onClick={()=>onOpen(page.id)}><span>{page.title}</span><small>{page.status==="ready" ? "Saved" : page.status==="building" || page.status==="solving" ? "Generating…" : page.status==="answer-only" ? "Answer saved" : "Needs attention"}</small></button><details className="nb-book-menu"><summary aria-label={`Actions for question ${page.title}`}>•••</summary><div><button type="button" onClick={()=>setQuestionEdit({id:page.id,name:page.title})}>Rename…</button><button type="button" onClick={()=>onArchiveQuestion(page.id,true)}>Remove question</button></div></details></div>
              {questionEdit?.id===page.id ? <form className="nb-book-edit" onSubmit={e=>{e.preventDefault();if(questionEdit.name.trim()){onRenameQuestion(page.id,questionEdit.name);setQuestionEdit(null);}}}><label className="nb-field" htmlFor={`question-name-${page.id}`}>Question name</label><input id={`question-name-${page.id}`} className="nb-input" value={questionEdit.name} maxLength={160} onChange={e=>setQuestionEdit({...questionEdit,name:e.target.value})} required autoFocus/><div className="nb-create-actions"><button type="button" className="nb-btn" onClick={()=>setQuestionEdit(null)}>Cancel</button><button className="nb-btn nb-btn-primary" type="submit">Save name</button></div></form> : null}
            </div>)}
            {!pages.length ? <p className="nb-note">No questions yet. Use New question to add one.</p> : null}
            {removed.length ? <details><summary className="nb-note">Removed questions ({removed.length})</summary><p className="nb-note">Their problems, solutions, simulations and videos are kept.</p>{removed.map(page=><div className="nb-book-heading" key={page.id}><span>{page.title}</span><button className="nb-btn nb-btn-quiet" type="button" onClick={()=>onArchiveQuestion(page.id,false)}>Restore</button></div>)}</details> : null}
          </div>
        </div>;
      })}
    </nav>
    </> : null}
  </section>;
}
