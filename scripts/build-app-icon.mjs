// Rasterize the existing two-diamond brand mark for the native Mac package.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'assets','mac'),iconset=path.join(directory,'A2ACraft.iconset');
await mkdir(iconset,{recursive:true});
function crc(data){let n=0xffffffff;for(const x of data){n^=x;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(name,data){const t=Buffer.from(name),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,c]);}
function png(size){
 const pixels=Buffer.alloc((size*4+1)*size),sample=4;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const sum=[0,0,0,0];
  for(let sy=0;sy<sample;sy++)for(let sx=0;sx<sample;sx++){
   const u=(x+(sx+.5)/sample)/size,v=(y+(sy+.5)/sample)/size;
   const qx=Math.max(Math.abs(u-.5)-.31,0),qy=Math.max(Math.abs(v-.5)-.31,0);
   if(qx*qx+qy*qy>.15*.15)continue;
   const d=Math.abs(u-.5)/.29+Math.abs(v-.5)/.36;
   const mark=Math.abs(d-1)<.052||Math.abs(d-.49)<.047;
   const color=mark?[231,195,117]:[18+12*(1-v),39+18*(1-v),43+19*(1-v)];
   for(let k=0;k<3;k++)sum[k]+=color[k];sum[3]+=255;
  }
  const i=y*(size*4+1)+1+x*4,alpha=sum[3]/(sample*sample);
  for(let k=0;k<3;k++)pixels[i+k]=alpha?Math.round(sum[k]*255/sum[3]):0;
  pixels[i+3]=Math.round(alpha);
 }
 const h=Buffer.alloc(13);h.writeUInt32BE(size);h.writeUInt32BE(size,4);h[8]=8;h[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
for(const n of [16,32,128,256,512])for(const scale of [1,2])await writeFile(path.join(iconset,`icon_${n}x${n}${scale===2?'@2x':''}.png`),png(n*scale));
await writeFile(path.join(directory,'A2ACraft.png'),png(1024));
await writeFile(path.join(directory,'A2ACraft.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" rx="15" fill="#173339"/><g fill="none" stroke="#e7c375" stroke-width="2.4"><path d="M50 14 79 50 50 86 21 50Z"/><path d="M50 32.36 64.21 50 50 67.64 35.79 50Z"/></g></svg>\n');
const icons=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]].map(([type,size])=>{
 const data=png(size),header=Buffer.alloc(8);header.write(type);header.writeUInt32BE(data.length+8,4);return Buffer.concat([header,data]);
});
const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(icons.reduce((n,b)=>n+b.length,8),4);
await writeFile(path.join(directory,'A2ACraft.icns'),Buffer.concat([header,...icons]));
console.log('A2ACraft native icon prepared');
