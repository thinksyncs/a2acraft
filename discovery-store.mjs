import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {encodeDiscovery,importDiscovery,validateDiscoveryState,emptyDiscoveryState,discoveryProgress} from './public/discovery-code.js';

const kinds={village:'idea',forest:'method',library:'comparison',harbor:'validation'};
const opaque=(domain,value)=>createHash('sha256').update('a2acraft-discovery-v1\0'+domain+'\0'+value).digest('base64url').slice(0,22);
export class DiscoveryStore{
  constructor(directory,onChange=()=>{},io={readFile,writeFile,rename}){
    this.file=path.join(directory,'discoveries.json');this.onChange=onChange;this.io=io;
    this.value=emptyDiscoveryState();this.writing=Promise.resolve();
  }
  public(){return {...structuredClone(this.value),...discoveryProgress(this.value)};}
  async load(){
    try{
      const raw=await this.io.readFile(this.file,'utf8');
      if(raw.length>500000)throw Error('共有した発見の記録が大きすぎます。');
      this.value=validateDiscoveryState(JSON.parse(raw));
    }catch(error){if(error.code!=='ENOENT')throw error;}
    return this;
  }
  async copy(journal,questId){
    if(typeof questId!=='string'||!questId||questId.length>128)throw Error('コピーする発見を選択してください。');
    const entry=Array.isArray(journal)&&journal.find(row=>row.questId===questId);
    if(!entry||!Object.hasOwn(kinds,entry.regionId))throw Error('受け取った冒険の成果から発見をコピーできます。');
    // Hash only internal identifiers. Request/title/output are never inspected.
    return {code:encodeDiscovery({questId:opaque('quest',entry.questId),
      discoveryId:opaque('finding',entry.questId+'\0'+entry.regionId),kind:kinds[entry.regionId]})};
  }
  async import(code){
    this.writing=this.writing.catch(()=>{}).then(async()=>{
      const result=importDiscovery(this.value,code);
      if(result.added){
        await this.io.writeFile(this.file+'.tmp',JSON.stringify(result.state),{mode:0o600});
        await this.io.rename(this.file+'.tmp',this.file);
        this.value=result.state;this.onChange(this.public());
      }
      return {state:this.public(),added:result.added};
    });
    return this.writing;
  }
}
