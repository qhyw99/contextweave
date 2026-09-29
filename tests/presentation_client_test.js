const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const variants = ['interactive-architecture-diagram','interactive-architecture-diagram-pay','interactive-architecture-diagram-pptx','interactive-architecture-diagram-workbuddy'];
const recipe = {template:'crrc-central-v1', columns:['benefits','categories','core','purchasing_modes','departments','management_levels','legal_levels'], core_cells:['foundation','planning'], footer_required:true};
const name = 'enterprise-central-v1';
const caps = {authoring:{versions:[1],formats:['json','html'],kinds:['swimlane','cards','matrix'], presentation_presets:{[name]:recipe}}};
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
    assert.ok(validateBasePalette(JSON.stringify({style_preset:name, primary:'#123456'})).error);
    assert.equal(validatePresentation({}, {style_preset:name}, 'authoring').error.code, 'PRESENTATION_UNSUPPORTED');
    assert.equal(validatePresentation(caps, {style_preset:name}, 'co_design').error.code, 'PRESENTATION_UNSUPPORTED');
    const intent = {outline_intent_version:2, source:'Services', focus:'Services', regions:[{id:'services', label:'Services',source_quote:'Services',style_role:'business'}]};
    assert.equal(validateCoDesign(intent), intent);
    assert.throws(() => validateCoDesign({...intent,regions:[{...intent.regions[0],style_role:'band'}]}), /style_role/);
  });
  test(`${variant}: bad reference slots never submit a run; valid selection survives`, async () => {
    const temporary = fs.mkdtempSync(path.join(root,'.presentation-test-'));
    try {
      const filename = path.join(temporary,'matrix.json');
      const doc = {kind:'matrix',rows:3,footer:'Assurance',columns:recipe.columns.map(id => ({id,cells:id === 'core' ? [{id:'foundation'},{id:'planning'}] : []}))};
      const client = new CWClient();
      client.getCapabilities = async () => caps;
      let submitted;
      client.request = async (endpoint,payload) => {submitted=payload; return {status:'ok'};};
      fs.writeFileSync(filename,JSON.stringify({...doc,footer:''}));
      let result = await client.runGeneration({authoringFile:filename,basePalette:{style_preset:name}});
      assert.equal(result.error.code,'PRESENTATION_SLOTS'); assert.equal(submitted,undefined);
      fs.writeFileSync(filename,JSON.stringify({...doc,columns:[...doc.columns,{id:'assurance'}]}));
      result = await client.runGeneration({authoringFile:filename,basePalette:{style_preset:name}});
      assert.equal(result.error.code,'PRESENTATION_SLOTS'); assert.equal(submitted,undefined);
      fs.writeFileSync(filename,JSON.stringify(doc));
      result = await client.runGeneration({authoringFile:filename,basePalette:{style_preset:name}});
      assert.equal(result.status,'ok'); assert.equal(submitted.base_palette.style_preset,name);
      assert.deepEqual(submitted.authoring.source,doc);
    } finally {fs.rmSync(temporary,{recursive:true,force:true});}
  });
}
