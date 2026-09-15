(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NexumPinLayout=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Screen-space only. Coordinates supplied by Leaflet are never modified.
  function layout(points,{width=46,height=50}={}){
    const placed=[], offsets=new Map();
    const overlap=(a,b)=>Math.max(0,width-Math.abs(a.x-b.x))*Math.max(0,height-Math.abs(a.y-b.y))/(width*height);
    const ordered=[...points].sort((a,b)=>String(a.id).localeCompare(String(b.id),'pt-BR',{numeric:true}));
    for(const point of ordered){
      let candidate={x:point.x,y:point.y},found=false;
      const clear=p=>placed.every(other=>overlap(p,other)<=.5+1e-9);
      if(clear(candidate))found=true;
      // Smallest radial ring first; more points add rings, not geographic offsets.
      for(let radius=4;!found;radius+=4){
        const count=Math.max(16,Math.ceil(2*Math.PI*radius/4));
        for(let i=0;i<count;i++){
          const angle=2*Math.PI*i/count;
          candidate={x:point.x+radius*Math.cos(angle),y:point.y+radius*Math.sin(angle)};
          if(clear(candidate)){found=true;break;}
        }
      }
      offsets.set(point.id,{x:candidate.x-point.x,y:candidate.y-point.y});placed.push(candidate);
    }
    return offsets;
  }
  return {layout};
});
