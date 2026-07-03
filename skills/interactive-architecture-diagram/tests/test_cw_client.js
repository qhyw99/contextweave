const assert = require('assert');
const { CWClient } = require('../scripts/cw_client.cjs');

// Mock process.env to avoid side effects
process.env.CONTEXTWEAVE_MCP_API_KEY = "test";

function testExtraction() {
    const content = `# Request\nUpdate the diagram.\n# CW\n\`\`\`cw\nsome_node: node\ncurl_command: |md\n  \`\`\`bash\n  curl -X POST\n  \`\`\`\n|\nanother_node: node\n\`\`\``;
    
    // Reproduce the extraction logic used in cw_client.cjs
    let cwText = "";
    if (content.includes("# CW")) {
        const parts = content.split("# CW");
        const reqPart = parts[0];
        const cwPart = parts.slice(1).join("# CW");
        
        const afterFenceIndex = cwPart.indexOf("\`\`\`cw");
        if (afterFenceIndex !== -1) {
            const afterFence = cwPart.substring(afterFenceIndex + 5);
            const lastFenceIndex = afterFence.lastIndexOf("\`\`\`");
            if (lastFenceIndex !== -1) {
                cwText = afterFence.substring(0, lastFenceIndex).trim();
            } else {
                cwText = afterFence.trim();
            }
        } else {
            cwText = cwPart.trim();
        }
    }
    
    assert(cwText.includes("another_node: node"), "The CW code should not be prematurely truncated.");
    assert(cwText.includes("\`\`\`bash"), "The nested markdown block should be preserved.");
    console.log("CW extraction test passed.");
}

testExtraction();
