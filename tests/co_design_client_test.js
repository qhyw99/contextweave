const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CWClient, _internals } = require('../skills/interactive-architecture-diagram/scripts/cw_client.cjs');

const intent = { outline_intent_version: 2, source: '应用调用服务。服务必须突出。', focus: '调用关系',
  regions: [{id:'service',label:'服务',source_quote:'服务',open:['layout','routing']}],
  relationships:'unexpanded', requirements:[{id:'call',kind:'edge',target:'应用',related:'服务',source_quote:'应用调用服务'}] };

(async () => {
  _internals.validateOutlineIntent(intent, '');
  assert.throws(() => _internals.validateOutlineIntent({...intent, source:'其他内容'}, ''), /source_quote/);
  assert.throws(() => _internals.validateOutlineIntent({...intent, requirements:[{...intent.requirements[0],origin:'agent',strength:'hard'}]}, ''), /agent/);
  assert.throws(() => _internals.validateOutlineIntent({...intent, relationships:'forbidden'}, ''), /conflict/);
  const track = {...intent,requirements:[{id:'span',kind:'track_span',target:'服务',related:'应用',value:'1:3',source_quote:'服务'}]};
  _internals.validateOutlineIntent(track,'');
  assert.throws(() => _internals.validateOutlineIntent({...track,requirements:[{...track.requirements[0],value:'3:1'}]}, ''), /track span/);
  const filename = path.resolve(__dirname, 'co-design-fixture.tmp.json');
  fs.writeFileSync(filename, JSON.stringify(intent));
  try {
    for (const variant of ['', '-pay', '-pptx', '-workbuddy']) {
    const { CWClient: VariantClient } = require(`../skills/interactive-architecture-diagram${variant}/scripts/cw_client.cjs`);
    const client = new VariantClient();
    let calls = 0;
    client.getCapabilities = async () => ({co_design:{versions:[1],execution:'joint'}});
    client.request = async (endpoint,payload,options) => {
      calls++; assert.strictEqual(payload.outline_intent_version,2);
      assert.strictEqual(payload.co_design_revision,3);
      assert.deepStrictEqual(payload.co_design_edit_paths,['service']);
      assert.deepStrictEqual(payload.co_design_upstream_usage,{total_tokens:100,elapsed_seconds:2});
      if (variant === '-pay') assert.strictEqual(new URL(endpoint,'https://example.test').searchParams.get('request_id'),options.requestId);
      if (variant === '-pptx') assert.strictEqual(payload.export_pptx,true);
      return {status:'error',co_design:{revision:4,status:'needs_revision'}};
    };
    let result = await client.runGeneration({outlineFile:filename,validateRequestLength:true});
    assert.strictEqual(result.error.code,'CO_DESIGN_UNSUPPORTED');
    assert.strictEqual(calls,0);
    client.getCapabilities = async () => ({co_design:{versions:[1,2],execution:'joint'}});
    result = await client.runGeneration({outlineFile:filename,validateRequestLength:true,coDesignRevision:3,coDesignEditPaths:['service'],coDesignUpstreamUsage:{total_tokens:100,elapsed_seconds:2}});
    assert.strictEqual(calls,1);
    assert.strictEqual(result.co_design.revision,4);
    fs.writeFileSync(filename,JSON.stringify(track));
    result = await client.runGeneration({outlineFile:filename,validateRequestLength:true});
    assert.strictEqual(result.error.code,'CO_DESIGN_UNSUPPORTED');
    assert.strictEqual(calls,1);
    fs.writeFileSync(filename,JSON.stringify(intent));
    }
  } finally { fs.rmSync(filename,{force:true}); }
  console.log('co-design client tests passed');
})().catch(error => { console.error(error); process.exitCode=1; });
