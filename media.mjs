import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {LocalStore} from './local-store.mjs';
import {imageInfo,MAX_ATTACHMENT_BYTES} from './attachments.mjs';
const idPattern=/^[0-9a-f-]{36}$/;
export function inspectMedia(bytes){
 const raw=bytes.toString('utf8');
 if(/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(raw)){
  if(!/<\/svg>\s*$/i.test(raw)||/<!|<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b|\son[\w:-]+\s*=|@import|\\/i.test(raw))throw Error('このSVGには表示できないスクリプト・外部参照が含まれています。');
  for(const match of raw.matchAll(/(?:href|src)\s*=\s*(['"])(.*?)\1/gi))if(!/^#[\w:.-]+$/.test(match[2]))throw Error('SVGの外部参照は利用できません。');
  for(const match of raw.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi))if(!/^#[\w:.-]+$/.test(match[2]))throw Error('SVGの外部参照は利用できません。');
  const root=raw.match(/<svg\b[^>]*>/i)?.[0]||'',box=root.match(/\bviewBox\s*=\s*['"]\s*([\d.e+-]+)[,\s]+([\d.e+-]+)[,\s]+([\d.e+-]+)[,\s]+([\d.e+-]+)\s*['"]/i);
  const width=Number(root.match(/\bwidth\s*=\s*['"]([\d.]+)(?:px)?['"]/i)?.[1]||box?.[3]||300),height=Number(root.match(/\bheight\s*=\s*['"]([\d.]+)(?:px)?['"]/i)?.[1]||box?.[4]||150);
  if(!Number.isFinite(width*height)||width<=0||height<=0||width*height>40_000_000)throw Error('SVGのサイズを確認してください。');
  return {extension:'svg',mimeType:'image/svg+xml',width,height,format:'SVG',animated:/<(?:animate\w*|set)\b|@keyframes|\banimation\s*:/i.test(raw)};
 }
 const info=imageInfo(bytes);if(!info)throw Error('PNG・JPEG・GIF・WebP・APNG・SVGの画像を選んでください。');
 let animated=false,format=info.extension.toUpperCase();
 if(info.extension==='gif'){let offset=13+(bytes[10]&128?3*(2**((bytes[10]&7)+1)):0),frames=0;while(offset<bytes.length){const tag=bytes[offset++];if(tag===59)break;if(tag===33){offset++;}else if(tag===44){if(offset+9>bytes.length)break;const flags=bytes[offset+8];offset+=9;if(flags&128)offset+=3*(2**((flags&7)+1));offset++;frames++;}else break;while(offset<bytes.length){const length=bytes[offset++];if(!length)break;offset+=length;}}animated=frames>1;}
 if(info.extension==='webp')animated=bytes.toString('ascii',12,16)==='VP8X'&&Boolean(bytes[20]&2);
 if(info.extension==='png')for(let offset=8;offset+12<=bytes.length;){const length=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);if(offset+12+length>bytes.length)break;if(kind==='acTL'&&length>=8){format='APNG';animated=bytes.readUInt32BE(offset+8)>1;}offset+=12+length;}
 return {...info,format,animated};
}
export class MediaStore extends LocalStore{
 constructor(directory,onChange){super(path.join(directory,'media','index.json'),{version:1,revision:0,items:[]},onChange);this.directory=path.join(directory,'media');}
 async load(){await mkdir(this.directory,{recursive:true,mode:0o700});return super.load(value=>{if(value.version!==1||!Array.isArray(value.items)||value.items.some(item=>!idPattern.test(item.id)||!['png','jpg','gif','webp','svg'].includes(item.extension)))throw Error('画像の保存内容を確認できません。');});}
 public(){const value=super.public();value.items=value.items.map(({extension,...item})=>({...item,url:'/api/media/'+item.id}));return value;}
 async upload({name,bytes}){bytes=Buffer.from(bytes);if(!bytes.length||bytes.length>MAX_ATTACHMENT_BYTES)throw Error('画像は空でない10 MiB以内のファイルにしてください。');const info=inspectMedia(bytes),id=randomUUID();name=path.basename(String(name||'image').replaceAll('\\','/')).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200)||'image';const file=path.join(this.directory,id+'.'+info.extension);await writeFile(file,bytes,{mode:0o600,flag:'wx'});try{await this.mutate(value=>{if(value.items.length>=2000||value.items.reduce((sum,item)=>sum+item.size,0)+bytes.length>500*1024*1024)throw Error('画像の保存上限に達しました。');value.items.push({id,name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),createdAt:Date.now(),...info});});}catch(error){await rm(file,{force:true});throw error;}return this.public().items.find(item=>item.id===id);}
 async read(id){const item=idPattern.test(id)&&this.value.items.find(item=>item.id===id);if(!item)throw Error('画像が見つかりません。');return {bytes:await readFile(path.join(this.directory,id+'.'+item.extension)),item};}
 async remove(id){const item=this.value.items.find(item=>item.id===id);if(!item)throw Error('画像が見つかりません。');await this.mutate(value=>{value.items=value.items.filter(item=>item.id!==id);});await rm(path.join(this.directory,id+'.'+item.extension),{force:true});}
}
