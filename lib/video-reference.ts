export interface SavedVideo {id:string;fingerprint:string}
export function removeSavedVideo<T extends {video?:SavedVideo;videoHistory?:SavedVideo[];simulations?:Array<{video?:SavedVideo}>}>(page:T,id:string):T {
  const videoHistory=(page.videoHistory ?? (page.video?[page.video]:[])).filter(video=>video.id!==id);
  return {...page,videoHistory,video:page.video?.id===id?videoHistory[0]:page.video,
    simulations:page.simulations?.map(saved=>saved.video?.id===id?{...saved,video:undefined}:saved)};
}
export function readVideoReference(value:unknown):SavedVideo|undefined {
  if(!value || typeof value!=="object")return;
  const candidate=value as Partial<SavedVideo>;
  if(typeof candidate.id!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(candidate.id))return;
  if(typeof candidate.fingerprint!=="string" || candidate.fingerprint.length>200000)return;
  return {id:candidate.id,fingerprint:candidate.fingerprint};
}
