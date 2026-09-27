import type {SavedPage} from "./cloud-notebooks";
import type {PageEntry} from "./notebooks";

/** Changes only the question's name or library visibility; keeps all learning content. */
export function editQuestionMetadata(entry:PageEntry,payload:SavedPage,change:{title?:string;removed?:boolean}):{entry:PageEntry;payload:SavedPage} {
  const title=change.title===undefined?entry.title:change.title.trim().slice(0,160);
  if(!title)throw new Error("Enter a question name.");
  const archivedAt=change.removed===undefined?entry.archivedAt:change.removed?new Date().toISOString():undefined;
  return {entry:{...entry,title,archivedAt,updatedAt:new Date().toISOString()},payload:{...payload,questionPage:{...payload.questionPage,...(change.title!==undefined?{title}:{}),archivedAt}}};
}
