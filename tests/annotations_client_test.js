const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(root, '.annotations-test-'));
after(() => fs.rmSync(dir, {recursive:true, force:true}));
const notes = {version:1, items:[{id:'expiry', text:'完整中文备注\r\n<script>仅作文本</script>'}]};
const noteFile = path.join(dir, 'notes.json');
fs.writeFileSync(noteFile, JSON.stringify(notes));
const clearFile = path.join(dir, 'clear.json');
fs.writeFileSync(clearFile, '[]');
const modelFile = path.join(dir, 'model.json');
fs.writeFileSync(modelFile, JSON.stringify({kind:'cards',title:'授权',items:[{id:'gate',title:'网关'}],annotations:notes}));
for(const name of ['interactive-architecture-diagram','interactive-architecture-diagram-pay','interactive-architecture-diagram-pptx','interactive-architecture-diagram-workbuddy']) {
  const {CWClient} = require(path.join(root,'skills',name,'scripts/cw_client.cjs'));
  test(`${name}: notes only, explicit clear and structured notes retain machine receipt`, async () => {
    const c = new CWClient(); const requests=[];
    c.getCapabilities = async () => ({annotations:{versions:[1]},authoring:{versions:[1],formats:['json'],kinds:['swimlane','cards','matrix']}});
    c.request = async (endpoint,payload) => {requests.push({endpoint,payload});return {status:'ok',annotations_version:1,exports:[{download_url:'https://example.test/diagram.html'}]};};
    for(const f of [noteFile,clearFile]) assert.equal((await c.runGeneration({sessionId:'saved',annotationsFile:f,validateRequestLength:true})).status,'ok');
    assert.deepEqual(requests[0].payload.annotations,notes);
    assert.deepEqual(requests[1].payload.annotations,{version:1,items:[]});
    assert.equal(requests[0].payload.user_request,undefined);
    assert.equal((await c.runGeneration({authoringFile:modelFile})).status,'ok');
    assert.deepEqual(requests[2].payload.authoring.source.annotations,notes);
    assert.equal(JSON.stringify(requests).includes(dir),false);
    c.request=async()=>({status:'ok',exports:[{download_url:'https://example.test/diagram.html'}]});
    for(const args of [{sessionId:'saved',annotationsFile:noteFile},{authoringFile:modelFile}]) {
      const r=await c.runGeneration(args); assert.equal(r.error.code,'ANNOTATIONS_UNSUPPORTED');assert.equal(r.exports.length,1);
    }
  });
  test(`${name}: unsupported backend and invalid file fail before generation`, async()=>{
    const c=new CWClient();c.request=async()=>assert.fail('must not generate');
    c.getCapabilities=async()=>({});
    assert.equal((await c.runGeneration({annotationsFile:noteFile,sessionId:'saved'})).error.code,'ANNOTATIONS_UNSUPPORTED');
    assert.equal((await c.runGeneration({annotationsFile:'relative.json',sessionId:'saved'})).error.code,'INVALID_ANNOTATIONS');
  });
  test(`${name}: generate CLI accepts the paid notes-only entry and prints parseable receipt`, async t=>{
    const {main}=require(path.join(root,'skills',name,'scripts/generate_contextweave.cjs'));
    const seen=[]; const chunks=[];
    class Client {async runGeneration(args){seen.push(args);return {status:'ok',session_id:'saved',annotations_version:1,choices:[]};}}
    const write=t.mock.method(process.stdout,'write',data=>{chunks.push(String(data));return true});
    try {await main(['--session_id','saved','--annotations_file',noteFile],Client);}
    finally {write.mock.restore();}
    assert.equal(seen.length,1);
    assert.equal(seen[0].annotationsFile,noteFile);
    assert.equal(JSON.parse(chunks.join('')).annotations_version,1);
  });
}
