# StaticForge MCP Server Setup Guide

This guide will help you set up the StaticForge MCP server for Cursor IDE integration.

## Prerequisites

1. StaticForge server running with `config.enable_dev: true`
2. Cursor IDE installed
3. Node.js dependencies installed (`npm install`)

## Cursor IDE Configuration

### Method 1: Using Cursor Settings UI

1. Open Cursor IDE
2. Go to Settings (Cmd/Ctrl + ,)
3. Search for "MCP" or "Model Context Protocol"
4. Add a new MCP server with the following configuration:

```json
{
  "mcpServers": {
    "staticforge-dev-bridge": {
      "command": "node",
      "args": ["/home/kanmi/staticforge/mcp-server.js"],
      "env": {}
    }
  }
}
```

### Method 2: Manual Configuration File

1. Navigate to your Cursor configuration directory:
   - **macOS**: `~/Library/Application Support/Cursor/User/`
   - **Windows**: `%APPDATA%\Cursor\User\`
   - **Linux**: `~/.config/Cursor/User/`

2. Create or edit `settings.json` and add:

```json
{
  "mcpServers": {
    "staticforge-dev-bridge": {
      "command": "node",
      "args": ["/home/kanmi/staticforge/mcp-server.js"],
      "env": {}
    }
  }
}
```

### Method 3: Using Cursor Rules

Add this to your `.cursorrules` file in your project:

```
# MCP Server Configuration
MCP_SERVER_PATH=/home/kanmi/staticforge/mcp-server.js
MCP_SERVER_COMMAND=node
```

## Testing the Setup

1. Start the StaticForge server:
   ```bash
   cd /home/kanmi/staticforge
   timeout 5 pm2 restart 12
   ```

2. Open a browser and navigate to your StaticForge application

3. Open the browser console and run:
   ```javascript
   mcpTakeOwnership();
   ```

4. In Cursor IDE, you should now be able to use MCP tools like:
   - `get_dev_logs` - Get browser console logs
   - `take_screenshot` - Take browser screenshots
   - `execute_javascript` - Run JavaScript in the browser
   - `query_elements` - Query DOM elements

## Available MCP Tools

### Logging Tools
- `get_dev_logs` - Retrieve browser console logs, errors, and warnings
- `get_network_logs` - Get network request/response logs
- `get_screenshots` - Retrieve screenshots taken by the browser
- `get_code_executions` - Get JavaScript code execution logs

### Browser Control Tools
- `take_screenshot` - Take screenshots of the browser or specific elements
- `execute_javascript` - Execute JavaScript code in the browser
- `query_elements` - Query DOM elements using CSS selectors
- `trigger_event` - Trigger events on DOM elements
- `send_command` - Send custom commands to browser clients

### Client Management
- `get_connected_clients` - List all connected browser clients and active client

## Troubleshooting

### MCP Server Not Starting
- Check that Node.js is installed and accessible
- Verify the path to `mcp-server.js` is correct
- Check Cursor IDE logs for error messages

### No Tools Available
- Ensure the StaticForge server is running
- Verify `config.enable_dev` is set to `true`
- Check that a browser client has taken ownership

### Connection Issues
- Verify the StaticForge server is accessible at `http://localhost:9220`
- Check that the admin authentication key is correct
- Ensure no firewall is blocking the connection

## Usage Examples

### Debug a JavaScript Error
```
Use get_dev_logs with type: "error" to find recent errors, then take_screenshot to see the current state, and execute_javascript to test fixes.
```

### Monitor Network Issues
```
Use get_network_logs to see recent network requests, filter by type: "error" to find failed requests.
```

### Test User Interactions
```
Use query_elements to find interactive elements, then trigger_event to simulate user interactions, and take_screenshot to verify results.
```

## Security Notes

- The MCP server only works in development mode
- All debugging endpoints require admin authentication
- WebSocket connections are only available on localhost
- All debugging data is stored locally in SQLite database

## Support

For issues or questions:
1. Check the `.cursorrules` file for detailed documentation
2. Review the server logs for error messages
3. Ensure all dependencies are properly installed
4. Verify the configuration is correct
