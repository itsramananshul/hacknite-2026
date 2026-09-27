export type LabelBox={left:number;right:number;bottom:number;top:number};
export function placeLabel(x:number,y:number,half:number,height:number,placed:LabelBox[]) {
  half=Math.min(.85,half);height=Math.min(.6,height);
  const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
  x=clamp(x,-.95+half,.95-half);y=clamp(y,-.92,.85-height);
  const fits=(cx:number,cy:number)=>cx-half>=-.951 && cx+half<=.951 && cy>=-.921 && cy+height<=.851 && !placed.some(p=>cx-half<p.right+.01 && cx+half>p.left-.01 && cy<p.top+.01 && cy+height>p.bottom-.01);
  let chosen={x,y,visible:false};
  search: for(let column=0;column<15;column++) {
    const dx=column===0?0:Math.ceil(column/2)*(2*half+.035)*(column%2?1:-1);
    for(let row=0;row<40;row++) {
      const dy=row===0?0:Math.ceil(row/2)*(height+.035)*(row%2?-1:1);
      if(fits(x+dx,y+dy)){chosen={x:x+dx,y:y+dy,visible:true};break search;}
    }
  }
  if(chosen.visible)placed.push({left:chosen.x-half,right:chosen.x+half,bottom:chosen.y,top:chosen.y+height});
  return chosen;
}
