const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const variants = ['interactive-architecture-diagram','interactive-architecture-diagram-pay','interactive-architecture-diagram-pptx','interactive-architecture-diagram-workbuddy'];
const recipe = {template:'shared-tracks'};
const name = 'red-gold-compact-v1';
const caps = {authoring:{versions:[1],formats:['json','html'],kinds:['swimlane','cards','matrix'],
  style_roles:['frame','foundation','planning','business'], presentation_presets:{[name]:recipe}}};
for (const variant of variants) {
  const dir = path.join(root,'skills',variant,'scripts');
  const {validateBasePalette} = require(path.join(dir,'generate_contextweave.cjs'));
  const {validatePresentation} = require(path.join(dir,'authoring.cjs'));
  const {validateCoDesign} = require(path.join(dir,'co_design.cjs'));
  const {CWClient} = require(path.join(dir,'cw_client.cjs'));
  test(`${variant}: version header matches the shipped Skill`, () => {
    const version = fs.readFileSync(path.join(dir,'..','SKILL.md'),'utf8').match(/^version:\s*(.+)$/m)[1].trim();
    assert.equal(new CWClient().headers()['X-Skill-Version'], version);
  });
  test(`${variant}: preset and role validation is explicit and cannot fall back`, () => {
    assert.equal(validateBasePalette(JSON.stringify({style_preset:name})).value.style_preset,name);
    assert.ok(validateBasePalette(JSON.stringify({style_preset:'enterprise-central-v1'})).error);
    assert.ok(validateBasePalette(JSON.stringify({style_preset:name, primary:'#123456'})).error);
    assert.equal(validatePresentation({}, {style_preset:name}, 'authoring').error.code, 'PRESENTATION_UNSUPPORTED');
    assert.equal(validatePresentation(caps, {style_preset:name}, 'co_design').error.code, 'PRESENTATION_UNSUPPORTED');
    const intent = {outline_intent_version:2, source:'Services', focus:'Services', regions:[{id:'services', label:'Services',source_quote:'Services',style_role:'business'}]};
    assert.equal(validateCoDesign(intent), intent);
    assert.throws(() => validateCoDesign({...intent,regions:[{...intent.regions[0],style_role:'band'}]}), /style_role/);
  });
  test(`${variant}: the enterprise example is ordinary data and permits new columns without a footer`, async () => {
    const temporary = fs.mkdtempSync(path.join(root,'.presentation-test-'));
    try {
      const filename = path.join(temporary,'matrix.json');
      const doc = JSON.parse(fs.readFileSync(path.join(dir,'..','references','enterprise-central-example.json'),'utf8'));
      assert.equal(doc.template,'shared-tracks');
      assert.equal(doc.presentation_preset,name);
      const mainExample = fs.readFileSync(path.join(root,'skills',variants[0],'references','enterprise-central-example.json'),'utf8');
      assert.deepEqual(doc,JSON.parse(mainExample));
      const client = new CWClient();
      client.getCapabilities = async () => caps;
      let submitted;
      client.request = async (endpoint,payload) => {submitted=payload; return {status:'ok'};};
      fs.writeFileSync(filename,JSON.stringify({...doc,presentation_preset:'enterprise-central-v1'}));
      let result = await client.runGeneration({authoringFile:filename,basePalette:{style_preset:name}});
      assert.equal(result.error.code,'PRESENTATION_CONFLICT'); assert.equal(submitted,undefined);
      delete doc.footer;
      doc.columns.reverse();
      doc.columns.push({id:'assurance',style_role:'planning',cells:[{id:'audit',title:'Audit',span:doc.rows.length}]});
      fs.writeFileSync(filename,JSON.stringify(doc));
      result = await client.runGeneration({authoringFile:filename,basePalette:{style_preset:name}});
      assert.equal(result.status,'ok'); assert.equal(submitted.base_palette.style_preset,name);
      assert.deepEqual(submitted.authoring.source,doc);
    } finally {fs.rmSync(temporary,{recursive:true,force:true});}
  });
  test(`${variant}: shared-track themes accept arbitrary slots and validate nested roles`, async () => {
    const themes = ['red-gold-compact-v1', 'blue-compact-v1'];
    const supported = {authoring:{...caps.authoring,
      style_roles:['frame','foundation','planning','business'],
      presentation_presets:Object.fromEntries(themes.map(theme => [theme,{template:'shared-tracks'}]))}};
    for (const theme of themes) {
      const doc = {kind:'matrix',template:'shared-tracks',presentation_preset:theme,rows:6,
        style_role:'business',columns:[{id:'custom_business',style_role:'foundation',cells:[
          {id:'custom_region',title:'Capabilities',span:6,items:[{id:'item',title:'Service',style_role:'planning'}]}]}]};
      assert.equal(validatePresentation(supported, {}, 'authoring', doc), null);
      const bad = structuredClone(doc);
      bad.columns[0].cells[0].items[0].style_role='unknown';
      assert.equal(validatePresentation(supported, {}, 'authoring', bad).error.code,'PRESENTATION_UNSUPPORTED');
      const oldCapabilities = structuredClone(supported);
      delete oldCapabilities.authoring.style_roles;
      assert.equal(validatePresentation(oldCapabilities, {}, 'authoring', doc).error.code,'PRESENTATION_UNSUPPORTED');
      delete doc.presentation_preset;
      assert.equal(validatePresentation(supported, {}, 'authoring', doc).error.code,'PRESENTATION_REQUIRED');
      assert.equal(validatePresentation(supported, {}, 'authoring', doc, 'saved-session'), null);
    }
  });
}
