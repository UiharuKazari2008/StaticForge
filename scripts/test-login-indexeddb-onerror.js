const fs = require('fs');

async function runTest() {
    console.log("Testing public/scripts/login.js for ReferenceError");

    // Read the login.js file
    const loginScript = fs.readFileSync('public/scripts/login.js', 'utf-8');

    // Search for the specific string we want to fix
    if (loginScript.includes("openReq.onerror = () => { console.warn('Error closing database connection:', e); };")) {
        console.error("FAILED: The script contains the bug (ReferenceError).");
        process.exit(1);
    }

    if (loginScript.includes("openReq.onerror = (e) => { console.warn('Error closing database connection:', e); };")) {
        console.log("SUCCESS: The script has the fix.");
        process.exit(0);
    }

    console.error("FAILED: Could not find the expected string or fix in the script.");
    process.exit(1);
}

runTest();
