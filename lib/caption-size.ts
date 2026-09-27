// Perspective captions have a fixed CSS-pixel size at every camera distance.
export function captionWorldScale(depth:number,fov:number,height:number,fontSize:number,pixels=13){
  return (2*Math.max(.001,depth)*Math.tan(fov*Math.PI/360)/Math.max(1,height))*pixels/fontSize;
}
export function captionBox(text:string,width:number,height:number,fontSize=.2){
  const chars=Math.floor(3/(fontSize*.6));
  return {half:(Math.min(chars,text.length)*7.8+12)/Math.max(1,width),height:(Math.max(1,Math.ceil(text.length/chars))*17+8)*2/Math.max(1,height)};
}
export function captionMagnitude(value:number){
  return value!==0 && (Math.abs(value)<.01 || Math.abs(value)>=1e6) ? value.toPrecision(3) : value.toFixed(2);
}
