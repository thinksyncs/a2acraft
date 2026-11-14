import {readFile,writeFile,rename} from 'node:fs/promises';
export class LocalStore{
 constructor(file,value,onChange=()=>{}){Object.assign(this,{file,value,onChange});this.writing=Promise.resolve();}
 async load(validate){try{const raw=await readFile(this.file,'utf8');if(raw.length>50_000_000)throw Error('保存内容が大きすぎます。');const value=JSON.parse(raw);validate(value);this.value=value;}catch(error){if(error.code!=='ENOENT')throw error;}return this;}
 public(){return structuredClone(this.value);}
 mutate(change){
  this.writing=this.writing.catch(()=>{}).then(async()=>{const next=structuredClone(this.value),result=change(next);next.revision=(next.revision||0)+1;await writeFile(this.file+'.tmp',JSON.stringify(next),{mode:0o600});await rename(this.file+'.tmp',this.file);this.value=next;this.onChange(this.public());return structuredClone(result);});return this.writing;
 }
}
