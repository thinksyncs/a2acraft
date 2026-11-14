import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {startPreviewServer} from '../electron/preview-server.mjs';
import {staticFiles} from '../public-assets.mjs';

test('packaged preview serves the complete static UI with no backend or write endpoints',async()=>{
  const token='preview-test-token-'.repeat(3);
  const preview=await startPreviewServer({root:fileURLToPath(new URL('../public',import.meta.url)),assets:staticFiles,token});
  const headers={Cookie:'chat_ui_session='+token};
  try{
    assert.equal((await fetch(preview.origin+'/')).status,403);
    for(const resource of Object.keys(staticFiles)){
      const response=await fetch(preview.origin+resource,{headers});
      assert.equal(response.status,200,resource);
      assert.match(response.headers.get('content-security-policy'),/frame-src 'none'/);
    }
    for(const resource of ['/api/state','/events','/server.mjs','/package.json','/assets/%2e%2e/server.mjs']){
      assert.equal((await fetch(preview.origin+resource,{headers})).status,404,resource);
    }
    assert.equal((await fetch(preview.origin+'/',{headers,method:'POST'})).status,405);
    assert.equal((await fetch(preview.origin+'/',{headers:{...headers,Origin:'https://unrelated.example'}})).status,403);
  }finally{await preview.close();}
});
