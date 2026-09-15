const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {layout}=require('../map-pin-layout.js');
for(const count of [1,2,3,10,40]){
  const points=Array.from({length:count},(_,i)=>({id:String(i),x:100,y:100}));
  const original=JSON.stringify(points),offsets=layout(points);
  assert.deepEqual(offsets.get('0'),{x:0,y:0});
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++){
    const a=offsets.get(String(i)),b=offsets.get(String(j));
    const overlap=Math.max(0,46-Math.abs(a.x-b.x))*Math.max(0,50-Math.abs(a.y-b.y))/(46*50);
    assert.ok(overlap<=.50000001,`${count}: ${i}/${j} overlap ${overlap}`);
  }
  assert.equal(JSON.stringify(points),original,'Coordinates must not change');
  assert.deepEqual(layout([...points].reverse()),offsets,'Stable across ordering');
}
const near=[{id:'A',x:0,y:0},{id:'B',x:8,y:0}];
assert.notDeepEqual(layout(near).get('B'),{x:0,y:0});
assert.deepEqual(layout([{id:'A',x:0,y:0},{id:'B',x:80,y:0}]).get('B'),{x:0,y:0},'Zoom separation removes offset');
for(const file of ['mapa.html','inicio.html']){
  const html=fs.readFileSync(file,'utf8');
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(match[1],{filename:file});
}
new vm.Script(fs.readFileSync('auth.js','utf8'));
console.log('OK: 1–40 coincident pins, <=50% overlap, immutable coordinates, stable order, zoom separation, JS syntax.');
