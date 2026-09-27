import {compressToEncodedURIComponent} from "lz-string";
import type {SceneScript} from "./schema";
export function sceneShareLink(address:string,scene:SceneScript){
 const url=new URL(address);
 url.search="";
 url.hash=`scene=${compressToEncodedURIComponent(JSON.stringify(scene))}`;
 return url.toString();
}
