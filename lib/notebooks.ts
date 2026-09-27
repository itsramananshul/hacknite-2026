export type Subject = "physics" | "chemistry" | "mathematics";
export interface Notebook { id: string; name: string; subject: Subject }
export interface PageEntry { id: string; notebookId: string; title: string; status: string; updatedAt: string; archivedAt?:string }
export interface Library { notebooks: Notebook[]; pages: PageEntry[] }
/** A fresh device should open a notebook with questions, not an empty namesake. */
export function initialNotebook(library:Library,selected:string|null):string {
  const chosen=library.notebooks.find(n=>n.id===selected);
  if(chosen){
    // Older imports created same-name copies of the empty starter notebooks.
    if(["physics","chemistry","mathematics"].includes(chosen.id) && !library.pages.some(p=>p.notebookId===chosen.id)){
      const populated=library.notebooks.find(n=>n.id!==chosen.id && n.name===chosen.name && library.pages.some(p=>p.notebookId===n.id));
      if(populated)return populated.id;
    }
    return chosen.id;
  }
  const newest=[...library.pages].filter(p=>!p.archivedAt).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).find(p=>library.notebooks.some(n=>n.id===p.notebookId));
  return newest?.notebookId ?? library.notebooks[0]?.id ?? "";
}
export const EMPTY_LIBRARY: Library = {notebooks:[],pages:[]};
const KEY = "chalk-library:v1";
export function readLibrary(storage: Pick<Storage,"getItem">): Library {
  const raw = storage.getItem(KEY);
  if (!raw) return structuredClone(EMPTY_LIBRARY);
  try {
    const value = JSON.parse(raw) as Library;
    if (!Array.isArray(value.notebooks) || !Array.isArray(value.pages)) throw new Error();
    const notebooks = value.notebooks.filter(n => typeof n.id==="string" && typeof n.name==="string" && ["physics","chemistry","mathematics"].includes(n.subject));
    if (!notebooks.length) return structuredClone(EMPTY_LIBRARY);
    const pages = value.pages.filter(p => typeof p.id==="string" && typeof p.title==="string" && notebooks.some(n=>n.id===p.notebookId));
    return {notebooks,pages};
  } catch { return structuredClone(EMPTY_LIBRARY); }
}
export function writeLibrary(storage: Pick<Storage,"setItem">,library: Library): void {
  storage.setItem(KEY,JSON.stringify(library));
}
export function upsertPage(library: Library,page: PageEntry): Library {
  return {...library,pages:[page,...library.pages.filter(p=>p.id!==page.id)]};
}
export function renameNotebook(library: Library,id: string,name: string): Library {
  const trimmed=name.trim().slice(0,80);
  if(!trimmed) throw new Error("Enter a notebook name.");
  return {...library,notebooks:library.notebooks.map(n=>n.id===id?{...n,name:trimmed}:n)};
}

// Object key order is not a content edit (cloud JSON may reorder keys).
export function contentSignature(value:unknown):string {
  return JSON.stringify(value,(_key,item)=>item && typeof item==="object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item);
}
