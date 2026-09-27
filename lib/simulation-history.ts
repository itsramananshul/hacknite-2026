import type {SceneScript} from "./schema";
import type {SavedVideo} from "./video-reference";
export interface SimulationVersion {id:string;createdAt:string;scene:SceneScript;values:Record<string,number>;solution:string;video?:SavedVideo}
export function keepSimulation(versions:SimulationVersion[],scene:SceneScript,values:Record<string,number>,solution:string,video?:SavedVideo){
 const existing=versions.find(v=>JSON.stringify(v.scene)===JSON.stringify(scene)&&JSON.stringify(v.values)===JSON.stringify(values)&&v.solution===solution);
 if(existing)return {versions,id:existing.id};
 const version:SimulationVersion={id:crypto.randomUUID(),createdAt:new Date().toISOString(),scene:structuredClone(scene),values:{...values},solution,...(video?{video}:{})};
 return {versions:[...versions,version],id:version.id};
}
