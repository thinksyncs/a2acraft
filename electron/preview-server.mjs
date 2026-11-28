import http from 'node:http';
import path from 'node:path';
import {readFile,lstat} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';

// The packaged demo serves reviewed frontend resources only. No application
// backend, Codex process, terminal or user workspace is started by this mode.
export async function startPreviewServer({root,assets,token,publicFramePolicy}){
  if(!path.isAbsolute(root)||typeof token!=='string'||token.length<32)throw Error('Invalid preview configuration');
  const types={'.json':'application/json','.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
  let origin;
  const server=http.createServer(async(req,res)=>{
    const reject=status=>{res.writeHead(status,{'Content-Type':'text/plain'});res.end('Unavailable');};
    try{
      if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin)return reject(403);
      const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('chat_ui_session='))?.slice(16)||'';
      if(Buffer.byteLength(cookie)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(cookie),Buffer.from(token)))return reject(403);
      if(!['GET','HEAD'].includes(req.method))return reject(405);
      const pathname=decodeURIComponent(req.url.split('?')[0]);
      const resource=assets[pathname]||(/^\/(assets|fonts)\/[A-Za-z0-9_./-]+$/.test(pathname)?pathname.slice(1):null);
      if(!resource||!types[path.extname(resource)]||(resource.endsWith('.json')&&!assets[pathname])||resource.split('/').some(part=>part==='..'||part.startsWith('.')))return reject(404);
      let file=root;
      for(const part of resource.split('/')){
        file=path.join(file,part);
        if((await lstat(file)).isSymbolicLink())return reject(403);
      }
      const body=await readFile(file);
      res.writeHead(200,{'Content-Type':types[path.extname(file)],'Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; "+publicFramePolicy(pathname,origin)});
      res.end(req.method==='HEAD'?undefined:body);
    }catch(error){reject(['ENOENT','ENOTDIR'].includes(error.code)?404:500);}
  });
  server.on('upgrade',(_req,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,close:()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();})};
}
