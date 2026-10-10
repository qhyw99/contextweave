// Old regression fixtures explicitly choose the default for requests without a
// color preference. Production code never guesses this from request prose.
const fs=require('node:fs');
function explicitDefaultFixture(client){
 const run=client.runGeneration.bind(client);
 client.runGeneration=options=>{
  let source=false;
  if(options.inputFile&&!client.validateSafePath(options.inputFile)&&fs.existsSync(options.inputFile)){
   const match=fs.readFileSync(options.inputFile,'utf8').match(/# CW[\s\S]*?```cw([\s\S]*?)```/);
   source=Boolean(match?.[1]?.trim());
  }
  return run({useDefaultPalette:!options.basePalette&&!options.sessionId&&!options.authoringFile&&!source,...options});
 };
 return client;
}
module.exports={explicitDefaultFixture};
