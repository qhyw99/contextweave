const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

async function test() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-failed-content-'));
  const cwd = process.cwd();
  const variables = ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'];
  const env = Object.fromEntries(variables.map(k=>[k,process.env[k]]));
  variables.forEach(k=>delete process.env[k]);
  const receipt = 'a'.repeat(32), artifact = 'b'.repeat(32);
  const text = Buffer.from('a: 已生成，但未通过完整验收\n', 'utf8');
  let posts = 0, downloads = 0, lastPayload;
  const fragmentBodies = new Map();
  const server = http.createServer((req,res)=>{
    if(req.method==='POST') {
      let body='';req.on('data',c=>body+=c);req.on('end',()=>{
        posts++;lastPayload=JSON.parse(body);
        res.writeHead(503,{'Content-Type':'application/json'});
        res.end(JSON.stringify({status:'error',quality:'rejected',delivery:'source',
          error:{code:'CO_DESIGN_NOT_ACCEPTED'},receipt:{id:receipt,status:'failed',quota:{status:'refunded'}},
          artifacts:[{id:artifact,kind:'source',format:'txt',name:'source.txt',editable:false,available:true,
            bytes:text.length,sha256:crypto.createHash('sha256').update(text).digest('hex'),
            download_path:`/requests/${receipt}/artifacts/${artifact}`}]}));
      });
    } else if(req.url===`/requests/${receipt}/artifacts/${artifact}`) {
      assert.equal(req.headers['x-api-key'],'synthetic-test-key');
      assert(req.headers['x-receipt-token']);downloads++;
      res.writeHead(200,{'Content-Type':'text/plain'});res.end(text);
    } else if(fragmentBodies.has(req.url)) {
      assert.equal(req.headers['x-api-key'],'synthetic-test-key');
      const bytes=fragmentBodies.get(req.url);
      if(bytes===null){res.writeHead(410);res.end();}
      else {res.writeHead(200);res.end(bytes);}
    } else { res.writeHead(404);res.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    process.chdir(temp);
    for(const variant of ['interactive-architecture-diagram','interactive-architecture-diagram-pptx','interactive-architecture-diagram-workbuddy']) {
      const {CWClient,downloadAssetsLocally}=require(path.join(__dirname,'../skills',variant,'scripts/cw_client.cjs'));
      const client=new CWClient();client.baseUrl=`http://127.0.0.1:${server.address().port}`;client.apiKey='synthetic-test-key';
      client.validateBaseUrl=()=>null; // Loopback transport fixture; production HTTPS validation has its own tests.
      const result=await client.runGeneration({sessionId:'existing',coDesignRevision:0,validateRequestLength:true});
      assert.equal(result.error?.code,'CO_DESIGN_NOT_ACCEPTED');
      assert.equal(lastPayload.co_design_revision,0,'empty continuation must preserve revision 0');
      assert.equal(result.status,'error');
      await downloadAssetsLocally({...result, output_dir:temp, output_name:variant},client,result.receipt?.access_token||'synthetic-token');
      const replay=await client.request('/run',{});replay.output_dir=temp;replay.output_name=variant+'-private-auth';
      await downloadAssetsLocally(replay);
      assert.equal(replay.saved_artifacts.length,1);
      assert.deepEqual(fs.readFileSync(replay.saved_artifacts[0].file_path),text);
      assert.equal(replay.saved_artifacts[0].editable,false);
      const printed=JSON.stringify(replay);
      assert(!printed.includes('synthetic-test-key')&&!printed.includes('synthetic-token'),'download credentials must never be serialized');
      assert.equal(replay.receipt.quota.status,'refunded');
    }
    assert.equal(posts,6,'terminal failed receipts must not trigger retries');
    assert.equal(downloads,6,'both live response and recovered result must save actual bytes');
    const whole=Buffer.from('a: 大文件候选\n\n  b: 原始空白必须保留\n','utf8');
    const wholeSha=crypto.createHash('sha256').update(whole).digest('hex');
    const fragments=[whole.subarray(0,11),whole.subarray(11)]; // Includes a UTF-8 character split across parts.
    const descriptors=fragments.map((bytes,index)=>{
      const id=(index?'d':'c').repeat(32),download_path=`/requests/${receipt}/artifacts/${id}`;
      fragmentBodies.set(download_path,bytes);
      return {id,download_path,available:true,editable:false,kind:'fragment',format:'bin',
        bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
        part_index:index+1,part_count:2,content_sha256:wholeSha,original_kind:'source',
        original_format:'txt',original_bytes:whole.length};
    });
    for(const variant of ['interactive-architecture-diagram','interactive-architecture-diagram-pptx','interactive-architecture-diagram-workbuddy']) {
      const {CWClient,downloadAssetsLocally}=require(path.join(__dirname,'../skills',variant,'scripts/cw_client.cjs'));
      const client=new CWClient();client.baseUrl=`http://127.0.0.1:${server.address().port}`;client.apiKey='synthetic-test-key';
      const makeResult=()=>({status:'error',quality:'rejected',delivery:'source',artifacts:descriptors,
        output_dir:temp,output_name:variant+'-fragment'});
      let result=makeResult();await downloadAssetsLocally(result,client,'synthetic-token');
      const assembled=result.saved_artifacts.find(a=>a.reassembled);
      assert(assembled,'all available fragments must be reconstructed');
      assert.deepEqual(fs.readFileSync(assembled.file_path),whole);
      assert.equal(assembled.sha256,wholeSha);assert.equal(assembled.editable,false);
      fragmentBodies.set(descriptors[1].download_path,null);
      result=makeResult();result.output_name+='-missing';await downloadAssetsLocally(result,client,'synthetic-token');
      assert.equal(result.saved_artifacts.length,1,'missing content must not be reported as complete');
      assert(!result.saved_artifacts.some(a=>a.reassembled));assert(result.warnings.some(w=>w.includes('下载失败')));
      fragmentBodies.set(descriptors[1].download_path,Buffer.from('corrupt bytes'));
      result=makeResult();result.output_name+='-corrupt';await downloadAssetsLocally(result,client,'synthetic-token');
      assert.equal(result.saved_artifacts.length,1,'wrong digest must not be accepted');
      assert(!result.saved_artifacts.some(a=>a.reassembled));
      assert(!fs.existsSync(path.join(temp,`${result.output_name}_content_${descriptors[1].id}.bin`)));
      fragmentBodies.set(descriptors[1].download_path,fragments[1]);
    }
  } finally {
    process.chdir(cwd);server.close();
    for(const k of variables){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}
    // Remove only the isolated directory returned by mkdtemp and verified above.
    fs.rmSync(temp,{recursive:true,force:true});
  }
  console.log('Failure artifact downloads verified for three free clients.');
}
test().catch(error=>{console.error(error);process.exitCode=1});
