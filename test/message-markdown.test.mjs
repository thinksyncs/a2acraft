import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMessageMarkdown,safeMarkdownUrl} from '../public/message-markdown.js';

function fixture(){
  const document={};
  class Node {
    constructor(tag='',text='',type=1){
      this.tagName=tag;this.value=text;this.nodeType=type;this.ownerDocument=document;
      this.children=[];this.attributes={};this.style={};this.dataset={};this.events={};this.replacements=0;
      this.classList={add:name=>{this.className=name;}};
    }
    set textContent(value){this.value=String(value);this.children=[];}
    get textContent(){return this.value+this.children.map(node=>node.textContent).join('');}
    append(...nodes){for(const node of nodes){if(node.nodeType===11)this.children.push(...node.children);else this.children.push(node);}}
    replaceChildren(...nodes){this.replacements++;this.value='';this.children=[];this.append(...nodes);}
    setAttribute(name,value){this.attributes[name]=String(value);}
    addEventListener(name,callback){this.events[name]=callback;}
  }
  document.createElement=tag=>new Node(tag);
  document.createTextNode=text=>new Node('',String(text),3);
  document.createDocumentFragment=()=>new Node('','',11);
  return document.createElement('div');
}
const all=(root,tag)=>[...(root.tagName===tag?[root]:[]),...root.children.flatMap(child=>all(child,tag))];

test('renders development Markdown: headings, nested lists, emphasis, literal fences and aligned tables',()=>{
  const root=fixture();
  renderMessageMarkdown(root,'# 実装状況\n\n**完了** と *確認中*、~~旧仕様~~。\n\n- 画面\n  - 2×2表示\n- [x] 保存\n\n3. 起動\n4. 確認\n\n> 注意ではなく説明\n\n```js\nconst html = "<script>**literal**</script>";\n```\n\n| 項目 | 結果 |\n| :--- | ---: |\n| 会話 | **OK** |');
  assert.equal(all(root,'h1')[0].textContent,'実装状況');
  assert.deepEqual(all(root,'strong').map(node=>node.textContent),['完了','OK']);
  assert.equal(all(root,'em')[0].textContent,'確認中');
  assert.equal(all(root,'del')[0].textContent,'旧仕様');
  assert.equal(all(root,'ul').length,2);
  assert.equal(all(root,'ol')[0].attributes.start,'3');
  assert.equal(all(root,'blockquote')[0].textContent,'注意ではなく説明');
  assert.equal(all(root,'pre')[0].textContent,'const html = "<script>**literal**</script>";');
  assert.equal(all(root,'code')[0].dataset.language,'js');
  assert.equal(all(root,'th')[1].style.textAlign,'right');
  assert.equal(all(root,'table').length,1);
  assert.equal(all(root,'script').length,0);
});

test('untrusted HTML and destinations cannot inject markup or load images',()=>{
  const root=fixture();
  renderMessageMarkdown(root,'<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [data](data:text/html,evil) [local](file:///private/a)\n\n![tracking](https://example.com/tracker.png) ![bad](javascript:evil)\n\n[safe](https://example.com/a_(b))');
  for(const tag of ['script','img','iframe','object','style'])assert.equal(all(root,tag).length,0);
  assert.ok(root.textContent.includes('<script>alert(1)</script>'));
  assert.deepEqual(all(root,'a').map(link=>link.href),['https://example.com/tracker.png','https://example.com/a_(b)']);
  for(const link of all(root,'a')){
    assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
    assert.deepEqual(Object.keys(link.events),[]);
  }
});

test('safe destinations reject credentials, controls and non-web schemes',()=>{
  for(const input of ['javascript:alert(1)','data:image/png;base64,AAAA','file:///tmp/a','ssh://host','https://user:secret@example.com','https://example.com\n','https://example.com/ with space','//example.com','<https://example.com>'])assert.equal(safeMarkdownUrl(input),null,input);
  assert.equal(safeMarkdownUrl('https://example.com/path?q=1&x=2'),'https://example.com/path?q=1&x=2');
});

test('streaming fences stay literal and unchanged content preserves DOM',()=>{
  const root=fixture(),open='```python\nprint("<b>hello</b>")';
  assert.equal(renderMessageMarkdown(root,open),true);
  const code=all(root,'code')[0];
  assert.equal(code.textContent,'print("<b>hello</b>")');
  assert.equal(renderMessageMarkdown(root,open),false);
  assert.equal(root.replacements,1);assert.equal(all(root,'code')[0],code);
  renderMessageMarkdown(root,open+'\n```\n\n**完了**');
  assert.equal(all(root,'strong')[0].textContent,'完了');assert.equal(all(root,'b').length,0);
});

test('links use the provided native opener only after an explicit click',async()=>{
  const root=fixture(),opened=[],errors=[];
  renderMessageMarkdown(root,'[成果](https://example.com/result)',{openLink:async url=>{opened.push(url);throw Error('Not registered');},onLinkError:error=>errors.push(error.message)});
  assert.deepEqual(opened,[]);
  let prevented=false;
  all(root,'a')[0].events.click({preventDefault(){prevented=true;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(prevented,true);assert.deepEqual(opened,['https://example.com/result']);assert.deepEqual(errors,['Not registered']);
});

test('inline code, escaped punctuation and table pipes retain their text',()=>{
  const root=fixture();
  renderMessageMarkdown(root,'Use `a_b` and \\*literal\\* with [docs](<https://example.com/docs> "title").\n\n| code | value |\n| --- | --- |\n| `a|b` | c\\|d |');
  assert.equal(all(root,'code')[0].textContent,'a_b');
  assert.ok(root.textContent.includes('*literal*'));
  assert.equal(all(root,'td')[0].textContent,'a|b');
  assert.equal(all(root,'td')[1].textContent,'c|d');
  assert.equal(all(root,'a')[0].href,'https://example.com/docs');
});

test('long imported text with unmatched delimiters is bounded and remains readable',()=>{
  for(const source of ['[unclosed '.repeat(12000),'*word '.repeat(16000)]){
    const root=fixture(),start=performance.now();
    renderMessageMarkdown(root,source);
    assert.equal(root.textContent,source);
    assert.ok(performance.now()-start<1500,'Unmatched delimiters must not cause quadratic parsing');
  }
});
