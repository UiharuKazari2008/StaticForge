#!/usr/bin/env node

/**
 * Script to generate test HTML file from test.dtext
 * This allows browser verification of dtext parsing updates
 */

const fs = require('fs');
const path = require('path');

async function generateTestHTML() {
    try {
        // Read the test.dtext file
        const testDtextPath = path.join(__dirname, 'test.dtext');
        const testDtext = fs.readFileSync(testDtextPath, 'utf8');
        
        // Import globalResources singleton to use parseDText
        const globalResources = require('../modules/globalResources');
        
        // Prepare and initialize if needed
        if (globalResources.prepare) {
            globalResources.prepare();
        }
        
        // Wait for initialization if not already initialized
        if (!globalResources.initialized) {
            await globalResources.initialize();
        }
        
        // Parse the dtext
        const html = await globalResources.parseDText(testDtext, 'danbooru', 'https://danbooru.donmai.us');
        
        // Create the HTML file
        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DText Conversion Test - test.dtext</title>
    <link rel="stylesheet" href="/styles.css">
    <style>
        body {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        }
        .tag-wiki-body-content {
            line-height: 1.6;
        }
        pre {
            background: #f5f5f5;
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            background: #f5f5f5;
            padding: 2px 4px;
            border-radius: 2px;
            font-family: 'Courier New', monospace;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 20px 0;
        }
        table th, table td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        table th {
            background-color: #f2f2f2;
            font-weight: bold;
        }
        .expandable {
            border: 1px solid #ddd;
            border-radius: 4px;
            margin: 10px 0;
        }
        .expandable-header {
            padding: 10px;
            background-color: #f9f9f9;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .expandable-header:hover {
            background-color: #f0f0f0;
        }
        .expandable-content {
            padding: 10px;
            display: none;
        }
        .expandable-content.expanded {
            display: block;
        }
        .expandable-button {
            padding: 5px 10px;
            cursor: pointer;
        }
        .spoiler {
            background-color: #000;
            color: #000;
            padding: 5px;
            border-radius: 3px;
        }
        .spoiler:hover {
            color: #fff;
        }
        .dtext-code-block {
            background: #f5f5f5;
            padding: 2px 4px;
            border-radius: 2px;
            font-family: 'Courier New', monospace;
            display: inline-block;
        }
        .tag-wiki-link {
            color: #0066cc;
            cursor: pointer;
            text-decoration: underline;
        }
        .tag-wiki-link:hover {
            color: #004499;
        }
        .tag-wiki-external-link {
            color: #0066cc;
        }
        .tag-wiki-anchor-link {
            color: #0066cc;
        }
        blockquote {
            border-left: 3px solid #ddd;
            padding-left: 15px;
            margin: 10px 0;
            color: #666;
        }
        hr {
            border: none;
            border-top: 1px solid #ddd;
            margin: 20px 0;
        }
    </style>
    <script>
        // Handle expandable blocks
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.expandable-button').forEach(button => {
                button.addEventListener('click', function() {
                    const content = this.closest('.expandable').querySelector('.expandable-content');
                    const isExpanded = content.classList.contains('expanded');
                    if (isExpanded) {
                        content.classList.remove('expanded');
                        this.value = 'Show';
                    } else {
                        content.classList.add('expanded');
                        this.value = 'Hide';
                    }
                });
            });
        });
    </script>
</head>
<body>
    <h1>DText Conversion Test</h1>
    <p>This page shows the HTML output from parsing test.dtext</p>
    <hr>
    <div class="tag-wiki-body-content">
${html}
    </div>
</body>
</html>`;
        
        // Write the HTML file
        const outputPath = path.join(__dirname, 'public', 'test-dtext-output.html');
        fs.writeFileSync(outputPath, htmlContent, 'utf8');
        
        console.log('✅ Test HTML file generated successfully at:', outputPath);
        console.log('📝 Open http://localhost:9220/test-dtext-output.html in your browser to verify');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error generating test HTML:', error);
        process.exit(1);
    }
}

generateTestHTML();

