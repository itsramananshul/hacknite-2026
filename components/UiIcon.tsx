import type {CSSProperties} from "react";
const paths={
 notebooks:"M6 5H3v17h14v-3M7 2h14v17H7V2Zm3 4h7m-7 4h4",
 problem:"M5 2h9l5 5v15H5V2Zm9 0v6h5M8 12h7m-7 4h7",
 variables:"M2 7h4m4 0h12M2 17h12m4 0h4M10 7a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm8 10a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z",
 regenerate:"M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1",
 edit:"m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5",
 account:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-5 12v-2a5 5 0 0 1 10 0v2",
 newPage:"M6 3h8l4 4v14H6V3Zm8 0v5h4M9 14h6m-3-3v6",
 share:"M8 8H5v13h14V8h-3M12 3v12m-4-8 4-4 4 4",
 play:"m8 5 11 7-11 7V5Z",pause:"M9 5v14M15 5v14",
 reset:"M4 10a8 8 0 1 0 3-5M4 3v7h7",
 volume:"m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
 mute:"m11 4-6 5H2v6h3l6 5V4Zm5 5 5 6m0-6-5 6",
 focus:"M12 2v4m0 12v4M2 12h4m12 0h4m-9-9 2 2m10-2-2 2M5 19l2-2m12 2-2-2M12 7l5 5-5 5-5-5 5-5Z",
 fullscreen:"M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
 predict:"M2 12h5l3-9 4 18 3-9h5",
 saved:"M7 18H5a4 4 0 0 1-1-8 7 7 0 0 1 13-3 5 5 0 0 1 2 11H7Zm1-6 3 3 5-5",
 arrow:"M4 12h16m-6-6 6 6-6 6",check:"m5 12 4 4L19 6",
 sigma:"M18 3H5l8 9-8 9h13",
};
export default function UiIcon({name,size=22,style}:{name:keyof typeof paths;size?:number;style?:CSSProperties}){
 return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name]}/></svg>;
}
