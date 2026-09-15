(function () {
  'use strict';

  function addSurface(targetMap, areas, options) {
    const metricOf=options.metricOf,maxMetric=Math.max(1,Number(options.maxMetric)||0),radiusOf=options.radiusOf,radiusUnit=options.radiusUnit||'meters',temperatureOf=options.temperatureOf||metricOf,temperatureMin=Number.isFinite(Number(options.temperatureMin))?Number(options.temperatureMin):0,temperatureMax=Number.isFinite(Number(options.temperatureMax))?Number(options.temperatureMax):maxMetric;
    const colorStops=[
      {at:0,color:[44,72,151]},
      {at:.16,color:[43,119,174]},
      {at:.32,color:[43,158,145]},
      {at:.47,color:[99,179,105]},
      {at:.56,color:[211,184,72]},
      {at:.7,color:[226,129,51]},
      {at:.84,color:[210,63,43]},
      {at:1,color:[164,30,38]}
    ];
    const clamp=value=>Math.min(1,Math.max(0,value));
    const normalizeTemperature=value=>clamp((Number(value)-temperatureMin)/(temperatureMax-temperatureMin||1));
    const colorAt=value=>{const upper=colorStops.find(stop=>stop.at>=value)||colorStops.at(-1),index=colorStops.indexOf(upper),lower=colorStops[Math.max(0,index-1)],ratio=(value-lower.at)/(upper.at-lower.at||1);return lower.color.map((channel,channelIndex)=>Math.round(channel+(upper.color[channelIndex]-channel)*ratio));};
    const HeatSurface=L.Layer.extend({
      initialize(rows){this._rows=rows;this._frame=null;},
      onAdd(mapInstance){this._map=mapInstance;if(!mapInstance.getPane('territorialHeatPane')){const pane=mapInstance.createPane('territorialHeatPane');pane.style.zIndex='350';pane.style.pointerEvents='none';}this._canvas=L.DomUtil.create('canvas','territorial-heat-surface leaflet-layer',mapInstance.getPane('territorialHeatPane'));this._canvas.style.pointerEvents='none';this._canvas.style.opacity='.93';this._canvas.style.filter='saturate(1.03) blur(1px)';mapInstance.on('moveend zoomend resize viewreset',this._schedule,this);this._schedule();},
      onRemove(mapInstance){mapInstance.off('moveend zoomend resize viewreset',this._schedule,this);if(this._frame)cancelAnimationFrame(this._frame);this._canvas?.remove();this._map=null;},
      _schedule(){if(this._frame)cancelAnimationFrame(this._frame);this._frame=requestAnimationFrame(()=>{this._frame=null;this._draw();});},
      _draw(){
        if(!this._map||!this._canvas)return;
        const size=this._map.getSize(),renderScale=Math.min(1,1100/Math.max(1,size.x),760/Math.max(1,size.y)),width=Math.max(1,Math.round(size.x*renderScale)),height=Math.max(1,Math.round(size.y*renderScale)),topLeft=this._map.containerPointToLayerPoint([0,0]),pixelCount=width*height;
        L.DomUtil.setPosition(this._canvas,topLeft);this._canvas.width=width;this._canvas.height=height;this._canvas.style.width=`${size.x}px`;this._canvas.style.height=`${size.y}px`;
        const weightedTemperature=new Float32Array(pixelCount),totalWeight=new Float32Array(pixelCount),envelope=new Float32Array(pixelCount);
        this._rows.forEach(area=>{const latitude=Number(area.latitude),longitude=Number(area.longitude);if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return;const point=this._map.latLngToContainerPoint([latitude,longitude]),metricNormalized=clamp(Number(metricOf(area))/maxMetric),temperature=normalizeTemperature(temperatureOf(area)),metersPerPixel=40075016.686*Math.max(.15,Math.abs(Math.cos(latitude*Math.PI/180)))/Math.pow(2,this._map.getZoom()+8),radius=Math.max(12,radiusUnit==='pixels'?Number(radiusOf(area)):Number(radiusOf(area))/metersPerPixel)*renderScale,centerX=point.x*renderScale,centerY=point.y*renderScale,minX=Math.max(0,Math.floor(centerX-radius)),maxX=Math.min(width-1,Math.ceil(centerX+radius)),minY=Math.max(0,Math.floor(centerY-radius)),maxY=Math.min(height-1,Math.ceil(centerY+radius)),visibility=.72+.28*Math.pow(metricNormalized,.55);for(let y=minY;y<=maxY;y+=1){const dy=(y-centerY)/radius,dy2=dy*dy;if(dy2>=1)continue;for(let x=minX;x<=maxX;x+=1){const dx=(x-centerX)/radius,distance2=dx*dx+dy2;if(distance2>=1)continue;const weight=Math.pow(1-Math.sqrt(distance2),1.3),index=y*width+x;weightedTemperature[index]+=temperature*weight;totalWeight[index]+=weight;envelope[index]=Math.max(envelope[index],weight*visibility);}}});
        const context=this._canvas.getContext('2d'),output=context.createImageData(width,height),pixels=output.data;
        for(let index=0;index<pixelCount;index+=1){const alpha=envelope[index];if(alpha<.006||totalWeight[index]<=0)continue;const averageTemperature=weightedTemperature[index]/totalWeight[index],spatialTemperature=clamp(averageTemperature*(.48+.52*Math.pow(alpha,.28))),color=colorAt(spatialTemperature),offset=index*4;pixels[offset]=color[0];pixels[offset+1]=color[1];pixels[offset+2]=color[2];pixels[offset+3]=Math.min(224,Math.round(230*Math.pow(alpha,.66)));}
        context.putImageData(output,0,0);
      }
    });
    return new HeatSurface(areas).addTo(targetMap);
  }
  window.NexumTerritorialHeat=Object.freeze({addSurface});
}());
