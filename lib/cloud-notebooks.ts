import type {SupabaseClient} from "@supabase/supabase-js";
import {type Library, type Notebook, type PageEntry} from "./notebooks";

export interface SavedPage {questionPage: {id:string; notebookId?:string; problemText:string; status:string; [key:string]:unknown}; scene:unknown; solution:string; values:Record<string,number>}
interface Pending {notebooks:Record<string,Notebook>; pages:Record<string,{entry:PageEntry; payload:SavedPage}>}
const PENDING="chalk-cloud-pending:v1";

// Guest keys stay compatible; signed-in caches never read another account's keys.
export function accountStorage(storage:Pick<Storage,"getItem"|"setItem">,userId:string|null) {
  const prefix=userId ? `chalk-account:${userId}:` : "";
  return {getItem:(key:string)=>storage.getItem(prefix+key),setItem:(key:string,value:string)=>storage.setItem(prefix+key,value)};
}
type Cache=ReturnType<typeof accountStorage>;
export function readPending(cache:Cache):Pending {
  try {const value=JSON.parse(cache.getItem(PENDING) ?? "null");if(value?.notebooks && value?.pages)return value;} catch { /* Keep a corrupt queue from replacing valid pages. */ }
  return {notebooks:{},pages:{}};
}
export function queueNotebooks(cache:Cache,previous:Library,next:Library) {
  const pending=readPending(cache);
  for(const notebook of next.notebooks)if(JSON.stringify(previous.notebooks.find(n=>n.id===notebook.id))!==JSON.stringify(notebook))pending.notebooks[notebook.id]=notebook;
  cache.setItem(PENDING,JSON.stringify(pending));
}
export function queuePage(cache:Cache,entry:PageEntry,payload:SavedPage,notebook:Notebook) {
  const pending=readPending(cache);pending.notebooks[notebook.id]=notebook;pending.pages[entry.id]={entry,payload};
  cache.setItem(PENDING,JSON.stringify(pending));
}
async function allRows(client:SupabaseClient,table:string,columns:string,userId:string) {
  const rows:Record<string,unknown>[]=[];
  for(let offset=0;;offset+=200){
    const {data,error}=await client.from(table).select(columns).eq("user_id",userId).order("id").range(offset,offset+199);
    if(error)throw new Error(error.message);
    rows.push(...(data ?? []) as unknown as Record<string,unknown>[]);
    if(!data || data.length<200) return rows;
  }
}
export async function loadCloudLibrary(client:SupabaseClient,userId:string,cache:Cache):Promise<Library> {
  const [books,pages]=await Promise.all([allRows(client,"notebooks","id,name,subject",userId),allRows(client,"question_pages","id,notebook_id,title,status,updated_at,payload",userId)]);
  const pending=readPending(cache);
  const notebooks=new Map(books.map(row=>[row.id as string,row as unknown as Notebook]));
  for(const notebook of Object.values(pending.notebooks))notebooks.set(notebook.id,notebook);
  const entries=new Map<string,PageEntry>();
  for(const row of pages){
    const id=row.id as string;
    if(!pending.pages[id])cache.setItem(`chalk-page:${id}`,JSON.stringify(row.payload));
    entries.set(id,{id,notebookId:row.notebook_id as string,title:row.title as string,status:row.status as string,updatedAt:row.updated_at as string});
  }
  for(const {entry,payload} of Object.values(pending.pages)){entries.set(entry.id,entry);cache.setItem(`chalk-page:${entry.id}`,JSON.stringify(payload));}
  cache.setItem(PENDING,JSON.stringify(pending));
  return {notebooks:[...notebooks.values()],pages:[...entries.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};
}
export async function flushCloud(client:SupabaseClient,userId:string,cache:Cache,isCurrent:()=>boolean):Promise<void> {
  const pending=readPending(cache);
  if(!isCurrent())return;
  const books=Object.values(pending.notebooks);
  if(books.length){const {error}=await client.from("notebooks").upsert(books.map(n=>({...n,user_id:userId,updated_at:new Date().toISOString()})),{onConflict:"user_id,id"});if(error)throw new Error(error.message);}
  // Check the account again between requests; RLS is the final authority on writes.
  if(!isCurrent())return;
  for(const {entry,payload} of Object.values(pending.pages)){
    if(!isCurrent())return;
    const {error}=await client.from("question_pages").upsert({user_id:userId,id:entry.id,notebook_id:entry.notebookId,title:entry.title.slice(0,160),status:entry.status,payload,updated_at:entry.updatedAt},{onConflict:"user_id,id"});
    if(error)throw new Error(error.message);
  }
  // Edits made during an upload remain queued rather than being lost.
  const latest=readPending(cache);
  for(const [id,value] of Object.entries(pending.notebooks))if(JSON.stringify(latest.notebooks[id])===JSON.stringify(value))delete latest.notebooks[id];
  for(const [id,value] of Object.entries(pending.pages))if(JSON.stringify(latest.pages[id])===JSON.stringify(value))delete latest.pages[id];
  cache.setItem(PENDING,JSON.stringify(latest));
}
