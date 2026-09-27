export type Subject = "physics" | "chemistry" | "mathematics";
export interface Notebook { id: string; name: string; subject: Subject }
export interface PageEntry { id: string; notebookId: string; title: string; status: string; updatedAt: string }
export interface Library { notebooks: Notebook[]; pages: PageEntry[] }
export const EMPTY_LIBRARY: Library = {
  notebooks: [{id:"physics",name:"Physics notebook",subject:"physics"},
    {id:"chemistry",name:"Chemistry notebook",subject:"chemistry"},
    {id:"mathematics",name:"Maths notebook",subject:"mathematics"}], pages: [],
};
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
