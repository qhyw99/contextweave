const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const variants=['interactive-architecture-diagram','interactive-architecture-diagram-pptx','interactive-architecture-diagram-workbuddy','interactive-architecture-diagram-pay'];
const rich={version:1,primary:'#124d54',secondary:'gold',background:'#102832'};
const caps={co_design:{palette:{versions:[1],fields:['version','primary','secondary','background'],choices:['selected','default','inherit'],routes:['co_design']}}};
for(const variant of variants){
 const dir=path.join(__dirname,'..','skills',variant,'scripts');
 const {validateBasePalette}=require(path.join(dir,'generate_contextweave.cjs'));
 const {CWClient}=require(path.join(dir,'cw_client.cjs'));
 function client(){const c=new CWClient();c.getCapabilities=async()=>caps;c.sent=[];c.request=async(e,p)=>{c.sent.push(p);return {status:'ok'};};return c;}
 test(`${variant}: extended fields survive normalization`,()=>{
   assert.deepEqual(validateBasePalette(JSON.stringify(rich)).value,{version:1,primary:'#124D54',secondary:'#B8860B',background:'#102832'});
   for(const p of [{}, {primary:'constructor'}, {primary:'__proto__'}, {primary:'#123456',typo:'x'}, {primary:'#123456',secondary:'#FFFFFF'}, {version:2,primary:'#123456'}, {version:1,primary:'#123456',style_preset:'corporate_blue'}]) assert.ok(validateBasePalette(JSON.stringify(p)).error);
 });
 test(`${variant}: omitted color choice stops before generation`,async()=>{
   const c=client();const r=await c.runGeneration({userRequest:'Show orders calling inventory.'});
   assert.equal(r.error.code,'PALETTE_SELECTION_REQUIRED');assert.equal(c.sent.length,0);
 });
 test(`${variant}: selected/default/inherit are explicit`,async()=>{
   const c=client();await c.runGeneration({userRequest:'Orders call inventory',basePalette:rich});
   assert.equal(c.sent[0].palette_choice,'selected');assert.equal(c.sent[0].base_palette.secondary,'#B8860B');
   await c.runGeneration({userRequest:'Orders call inventory',useDefaultPalette:true});
   assert.equal(c.sent[1].palette_choice,'default');assert.equal(c.sent[1].base_palette,undefined);
   await c.runGeneration({userRequest:'Retain the theme and rename an item',sessionId:'existing'});
   assert.equal(c.sent[2].palette_choice,'inherit');
 });
 test(`${variant}: capability gaps cannot silently remove color fields`,async()=>{
   const c=client();c.getCapabilities=async()=>({co_design:{}});
   const r=await c.runGeneration({userRequest:'Orders call inventory',basePalette:rich});
   assert.equal(r.error.code,'PALETTE_UNSUPPORTED');assert.equal(c.sent.length,0);
 });
 test(`${variant}: default cannot conflict with selected or inherited palette`,async()=>{
   const c=client();for(const args of [{basePalette:rich,useDefaultPalette:true},{sessionId:'existing',useDefaultPalette:true}]){
    const r=await c.runGeneration({userRequest:'Orders call inventory',...args});assert.equal(r.error.code,'PALETTE_CONFLICT');
   }assert.equal(c.sent.length,0);
 });
 test(`${variant}: authoring cannot silently drop the extended palette`,async()=>{
   const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'cw-palette-'));
   try{const f=path.join(temp,'model.json');fs.writeFileSync(f,JSON.stringify({kind:'cards',items:[]}));const c=client();
    const r=await c.runGeneration({authoringFile:f,basePalette:rich});assert.equal(r.error.code,'PALETTE_UNSUPPORTED');assert.equal(c.sent.length,0);
    const d=await c.runGeneration({authoringFile:f,useDefaultPalette:true});assert.equal(d.error.code,'PALETTE_UNSUPPORTED');assert.equal(c.sent.length,0);
   }finally{fs.rmSync(temp,{recursive:true,force:true});}
 });
}
