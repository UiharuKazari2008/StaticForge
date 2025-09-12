#!/usr/bin/env node

/**
 * MCP Server for StaticForge Development Bridge
 * Provides Cursor IDE integration for live browser debugging
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');
const WebSocket = require('ws');
const config = require('./config.json');
const UnixSocketCommunication = require('./modules/unixSocketCommunication');
const pm2 = require('pm2');

class StaticForgeMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'staticforge-dev-bridge',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.baseUrl = config.devBaseUrl || 'http://localhost:9220';
    this.authKey = config.devLoginKey;
    this.wsClient = null;
    this.activeClientId = null;
    
    // Initialize Unix Socket Communication
    this.unixSocket = new UnixSocketCommunication({
      socketPath: config.unixSocketPath
    });
    
    this.setupHandlers();
    this.connectToDevBridge();
    this.setupUnixSocketHandlers();
    this.connectToPM2();
  }

  connectToDevBridge() {
    const devPort = config.devPort || 9221;
    const devHost = config.devHost || 'localhost';
    const wsUrl = `ws://${devHost}:${devPort}`;
    
    try {
      this.devBridgeWs = new WebSocket(wsUrl);
      
      this.devBridgeWs.on('open', () => {
        console.log('🔧 MCP Server connected to dev bridge');
        // Request client list to get active client
        this.sendToDevBridge({ 
          type: 'mcp_request',
          requestType: 'get_clients',
          requestId: 'mcp_server_init'
        });
      });
      
      this.devBridgeWs.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleDevBridgeMessage(message);
        } catch (error) {
          console.error('Error parsing dev bridge message:', error);
        }
      });
      
      this.devBridgeWs.on('error', (error) => {
        console.error('Dev bridge WebSocket error:', error);
      });
      
      this.devBridgeWs.on('close', () => {
        console.log('Dev bridge WebSocket closed, reconnecting...');
        setTimeout(() => this.connectToDevBridge(), 5000);
      });
      
    } catch (error) {
      console.error('Failed to connect to dev bridge:', error);
    }
  }

  handleDevBridgeMessage(message) {
    // Handle responses from dev bridge
    if (message.type === 'client_list') {
      this.activeClientId = message.activeClient?.id || null;
    } else if (message.type === 'mcp_response' && message.data) {
      // Handle MCP responses from dev bridge
      if (message.data.activeClient) {
        this.activeClientId = message.data.activeClient.id || null;
        console.log('🔧 MCP Server: Active client set to', this.activeClientId);
      }
    } else {
      // Log unknown message types for debugging
      console.log('📨 Unknown message type from dev bridge client:', message.type);
    }
  }

  sendToDevBridge(message) {
    if (this.devBridgeWs && this.devBridgeWs.readyState === WebSocket.OPEN) {
      this.devBridgeWs.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  setupUnixSocketHandlers() {
    // Start Unix socket client
    this.unixSocket.startClient().catch((error) => {
      console.error('❌ Failed to start Unix socket client:', error);
    });
  }


  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_dev_logs',
            description: 'Get development logs from the browser with pagination support',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  description: 'Log type filter (log, error, warn, info, debug)',
                  enum: ['log', 'error', 'warn', 'info', 'debug', 'unhandledRejection']
                },
                level: {
                  type: 'string',
                  description: 'Log level filter',
                  enum: ['info', 'warn', 'error', 'debug']
                },
                clientId: {
                  type: 'string',
                  description: 'Filter by specific client ID'
                },
                limit: {
                  type: 'number',
                  description: 'Number of logs to return (default: 100)',
                  default: 100
                },
                offset: {
                  type: 'number',
                  description: 'Number of logs to skip (default: 0)',
                  default: 0
                },
                startTime: {
                  type: 'number',
                  description: 'Start timestamp filter (milliseconds)'
                },
                endTime: {
                  type: 'number',
                  description: 'End timestamp filter (milliseconds)'
                }
              }
            }
          },
          {
            name: 'get_network_logs',
            description: 'Get network request/response logs with pagination support',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  description: 'Network type filter (request, response, error)',
                  enum: ['request', 'response', 'error', 'service_worker_request']
                },
                clientId: {
                  type: 'string',
                  description: 'Filter by specific client ID'
                },
                limit: {
                  type: 'number',
                  description: 'Number of logs to return (default: 100)',
                  default: 100
                },
                offset: {
                  type: 'number',
                  description: 'Number of logs to skip (default: 0)',
                  default: 0
                },
                startTime: {
                  type: 'number',
                  description: 'Start timestamp filter (milliseconds)'
                },
                endTime: {
                  type: 'number',
                  description: 'End timestamp filter (milliseconds)'
                }
              }
            }
          },
          {
            name: 'get_screenshots',
            description: 'Get screenshots taken by the browser with pagination support',
            inputSchema: {
              type: 'object',
              properties: {
                clientId: {
                  type: 'string',
                  description: 'Filter by specific client ID'
                },
                limit: {
                  type: 'number',
                  description: 'Number of screenshots to return (default: 50)',
                  default: 50
                },
                offset: {
                  type: 'number',
                  description: 'Number of screenshots to skip (default: 0)',
                  default: 0
                },
                startTime: {
                  type: 'number',
                  description: 'Start timestamp filter (milliseconds)'
                },
                endTime: {
                  type: 'number',
                  description: 'End timestamp filter (milliseconds)'
                }
              }
            }
          },
          {
            name: 'get_code_executions',
            description: 'Get JavaScript code execution logs with pagination support',
            inputSchema: {
              type: 'object',
              properties: {
                clientId: {
                  type: 'string',
                  description: 'Filter by specific client ID'
                },
                limit: {
                  type: 'number',
                  description: 'Number of executions to return (default: 100)',
                  default: 100
                },
                offset: {
                  type: 'number',
                  description: 'Number of executions to skip (default: 0)',
                  default: 0
                },
                startTime: {
                  type: 'number',
                  description: 'Start timestamp filter (milliseconds)'
                },
                endTime: {
                  type: 'number',
                  description: 'End timestamp filter (milliseconds)'
                }
              }
            }
          },
          {
            name: 'get_connected_clients',
            description: 'Get list of connected browser clients and active client info'
          },
          {
            name: 'take_screenshot',
            description: 'Take a screenshot of the active browser client or specific element',
            inputSchema: {
              type: 'object',
              properties: {
                selector: {
                  type: 'string',
                  description: 'CSS selector for specific element (optional, takes full page if not provided)'
                },
                clientId: {
                  type: 'string',
                  description: 'Specific client ID to take screenshot from (optional, uses active client if not provided)'
                }
              }
            }
          },
          {
            name: 'execute_javascript',
            description: 'Execute JavaScript code in the active browser client',
            inputSchema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'JavaScript code to execute'
                },
                clientId: {
                  type: 'string',
                  description: 'Specific client ID to execute code in (optional, uses active client if not provided)'
                }
              },
              required: ['code']
            }
          },
          {
            name: 'query_elements',
            description: 'Query DOM elements in the active browser client',
            inputSchema: {
              type: 'object',
              properties: {
                selector: {
                  type: 'string',
                  description: 'CSS selector to query elements'
                },
                clientId: {
                  type: 'string',
                  description: 'Specific client ID to query (optional, uses active client if not provided)'
                }
              },
              required: ['selector']
            }
          },
          {
            name: 'trigger_event',
            description: 'Trigger an event on an element in the active browser client',
            inputSchema: {
              type: 'object',
              properties: {
                selector: {
                  type: 'string',
                  description: 'CSS selector for the target element'
                },
                eventType: {
                  type: 'string',
                  description: 'Type of event to trigger (click, input, change, etc.)'
                },
                eventData: {
                  type: 'object',
                  description: 'Additional event data (optional)'
                },
                clientId: {
                  type: 'string',
                  description: 'Specific client ID to trigger event in (optional, uses active client if not provided)'
                }
              },
              required: ['selector', 'eventType']
            }
          },
          {
            name: 'send_command',
            description: 'Send a custom command to a browser client',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  description: 'Command type'
                },
                data: {
                  type: 'object',
                  description: 'Command data'
                },
                clientId: {
                  type: 'string',
                  description: 'Specific client ID to send command to (optional, uses active client if not provided)'
                }
              },
              required: ['type']
            }
          },
          {
            name: 'get_pm2_status',
            description: 'Get PM2 process status for the StaticForge server'
          },
          {
            name: 'get_pm2_logs',
            description: 'Get PM2 logs for the StaticForge server',
            inputSchema: {
              type: 'object',
              properties: {
                lines: {
                  type: 'number',
                  description: 'Number of log lines to return (default: 100)',
                  default: 100
                },
                type: {
                  type: 'string',
                  description: 'Log type filter (out, err, combined)',
                  enum: ['out', 'err', 'combined'],
                  default: 'combined'
                }
              }
            }
          },
          {
            name: 'restart_pm2_server',
            description: 'Restart the StaticForge server via PM2'
          },
          {
            name: 'stop_pm2_server',
            description: 'Stop the StaticForge server via PM2'
          },
          {
            name: 'start_pm2_server',
            description: 'Start the StaticForge server via PM2'
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_dev_logs':
            return await this.getDevLogs(args);
          case 'get_network_logs':
            return await this.getNetworkLogs(args);
          case 'get_screenshots':
            return await this.getScreenshots(args);
          case 'get_code_executions':
            return await this.getCodeExecutions(args);
          case 'get_connected_clients':
            return await this.getConnectedClients();
          case 'take_screenshot':
            return await this.takeScreenshot(args);
          case 'execute_javascript':
            return await this.executeJavaScript(args);
          case 'query_elements':
            return await this.queryElements(args);
          case 'trigger_event':
            return await this.triggerEvent(args);
          case 'send_command':
            return await this.sendCommand(args);
          case 'get_pm2_status':
            return await this.getPm2Status();
          case 'get_pm2_logs':
            return await this.getPm2Logs(args);
          case 'restart_pm2_server':
            return await this.restartPm2Server();
          case 'stop_pm2_server':
            return await this.stopPm2Server();
          case 'start_pm2_server':
            return await this.startPm2Server();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    });
  }


  async getDevLogs(args) {
    try {
      // Use Unix socket to communicate with web server
      const data = await this.unixSocket.sendMessage('web', 'get_dev_logs', args, 'mcp');
      
      const logs = data.logs.map(log => ({
        id: log.id,
        timestamp: new Date(log.timestamp).toISOString(),
        type: log.type,
        level: log.level,
        message: log.message,
        stackTrace: log.stack_trace,
        url: log.url,
        clientId: log.client_id,
        data: log.data ? JSON.parse(log.data) : null
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${logs.length} development logs (${data.totalCount} total):\n\n` +
                  logs.map(log => 
                    `[${log.timestamp}] ${log.level.toUpperCase()} (${log.type}): ${log.message}` +
                    (log.stackTrace ? `\nStack: ${log.stackTrace}` : '') +
                    (log.url ? `\nURL: ${log.url}` : '') +
                    (log.clientId ? `\nClient: ${log.clientId}` : '') +
                    (log.data ? `\nData: ${JSON.stringify(log.data, null, 2)}` : '')
                  ).join('\n\n---\n\n')
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting dev logs: ${error.message}`
          }
        ]
      };
    }
  }

  async getNetworkLogs(args) {
    try {
      // Use Unix socket to communicate with web server
      const data = await this.unixSocket.sendMessage('web', 'get_network_logs', args, 'mcp');
      
      const logs = data.logs.map(log => ({
        id: log.id,
        timestamp: new Date(log.timestamp).toISOString(),
        type: log.type,
        url: log.url,
        method: log.method,
        statusCode: log.status_code,
        responseTime: log.response_time,
        requestSize: log.request_size,
        responseSize: log.response_size,
        clientId: log.client_id,
        headers: log.headers ? JSON.parse(log.headers) : null,
        body: log.body
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${logs.length} network logs:\n\n` +
                  logs.map(log => 
                    `[${log.timestamp}] ${log.type.toUpperCase()} ${log.method || ''} ${log.url}` +
                    (log.statusCode ? ` - ${log.statusCode}` : '') +
                    (log.responseTime ? ` (${log.responseTime}ms)` : '') +
                    (log.requestSize ? ` - Request: ${log.requestSize}b` : '') +
                    (log.responseSize ? ` Response: ${log.responseSize}b` : '') +
                    (log.clientId ? `\nClient: ${log.clientId}` : '') +
                    (log.headers ? `\nHeaders: ${JSON.stringify(log.headers, null, 2)}` : '') +
                    (log.body ? `\nBody: ${log.body}` : '')
                  ).join('\n\n---\n\n')
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting network logs: ${error.message}`
          }
        ]
      };
    }
  }

  async getScreenshots(args) {
    try {
      // Use Unix socket to communicate with web server
      const data = await this.unixSocket.sendMessage('web', 'get_screenshots', args, 'mcp');
      
      const screenshots = data.screenshots.map(screenshot => ({
        id: screenshot.id,
        timestamp: new Date(screenshot.timestamp).toISOString(),
        clientId: screenshot.client_id,
        url: screenshot.url,
        elementSelector: screenshot.element_selector,
        width: screenshot.width,
        height: screenshot.height,
        hasData: !!screenshot.screenshot_data
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${screenshots.length} screenshots:\n\n` +
                  screenshots.map(screenshot => 
                    `[${screenshot.timestamp}] Screenshot ${screenshot.id}` +
                    (screenshot.elementSelector ? ` (${screenshot.elementSelector})` : ' (full page)') +
                    ` - ${screenshot.width}x${screenshot.height}` +
                    (screenshot.url ? `\nURL: ${screenshot.url}` : '') +
                    (screenshot.clientId ? `\nClient: ${screenshot.clientId}` : '') +
                    (screenshot.hasData ? '\nData: Available' : '\nData: Not available')
                  ).join('\n\n---\n\n')
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting screenshots: ${error.message}`
          }
        ]
      };
    }
  }

  async getCodeExecutions(args) {
    try {
      // Use Unix socket to communicate with web server
      const data = await this.unixSocket.sendMessage('web', 'get_code_executions', args, 'mcp');
      
      const executions = data.executions.map(execution => ({
        id: execution.id,
        timestamp: new Date(execution.timestamp).toISOString(),
        clientId: execution.client_id,
        code: execution.code,
        result: execution.result ? JSON.parse(execution.result) : null,
        error: execution.error,
        executionTime: execution.execution_time
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${executions.length} code executions:\n\n` +
                  executions.map(execution => 
                    `[${execution.timestamp}] Code Execution ${execution.id}` +
                    (execution.executionTime ? ` (${execution.executionTime}ms)` : '') +
                    (execution.clientId ? `\nClient: ${execution.clientId}` : '') +
                    `\nCode: ${execution.code}` +
                    (execution.result ? `\nResult: ${JSON.stringify(execution.result, null, 2)}` : '') +
                    (execution.error ? `\nError: ${execution.error}` : '')
                  ).join('\n\n---\n\n')
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting code executions: ${error.message}`
          }
        ]
      };
    }
  }

  async getConnectedClients() {
    try {
      // Use Unix socket to communicate with web server
      const data = await this.unixSocket.sendMessage('web', 'get_connected_clients', {}, 'mcp');
      
      const clients = data.clients.map(client => ({
          id: client.id,
          ip: client.ip,
          userAgent: client.userAgent,
          connectedAt: new Date(client.connectedAt).toISOString(),
          sessionId: client.sessionId,
          url: client.url,
          isActive: client.isActive,
          isMaster: client.isMaster || false
      }));

      const activeClient = data.activeClient ? {
          id: data.activeClient.id,
          ip: data.activeClient.ip,
          userAgent: data.activeClient.userAgent,
          connectedAt: new Date(data.activeClient.connectedAt).toISOString(),
          sessionId: data.activeClient.sessionId,
          url: data.activeClient.url,
          isMaster: data.activeClient.isMaster || false
      } : null;

      const masterClient = data.masterClient ? {
          id: data.masterClient.id,
          ip: data.masterClient.ip,
          userAgent: data.masterClient.userAgent,
          connectedAt: new Date(data.masterClient.connectedAt).toISOString(),
          sessionId: data.masterClient.sessionId,
          url: data.masterClient.url
      } : null;

      return {
          content: [
              {
                  type: 'text',
                  text: `Connected Clients (${clients.length}):\n\n` +
                        clients.map(client => 
                          `${client.isActive ? '🟢 ACTIVE' : '⚪'} ${client.isMaster ? '🔧 MASTER' : ''} ${client.id}` +
                          `\n  IP: ${client.ip}` +
                          `\n  Connected: ${client.connectedAt}` +
                          (client.url ? `\n  URL: ${client.url}` : '') +
                          (client.sessionId ? `\n  Session: ${client.sessionId}` : '') +
                          `\n  User Agent: ${client.userAgent}`
                        ).join('\n\n') +
                        (activeClient ? `\n\nActive Client: ${activeClient.id} (${activeClient.url})` : '\n\nNo active client') +
                        (masterClient ? `\n\nMaster Client: ${masterClient.id} (${masterClient.url})` : '\n\nNo master client')
              }
          ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting connected clients: ${error.message}`
          }
        ]
      };
    }
  }

  async takeScreenshot(args) {
    const { selector, clientId } = args;
    const targetClientId = clientId || this.activeClientId;

    if (!targetClientId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active client available. Please ensure a browser client has taken ownership using mcpTakeOwnership()'
          }
        ]
      };
    }

    try {
      await this.sendWebSocketRequest('screenshot', { selector }, targetClientId);
      
      return {
        content: [
          {
            type: 'text',
            text: `Screenshot command sent to client ${targetClientId}` +
                  (selector ? ` for element: ${selector}` : ' (full page)') +
                  `\nTimestamp: ${new Date().toISOString()}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error taking screenshot: ${error.message}`
          }
        ]
      };
    }
  }

  async executeJavaScript(args) {
    const { code, clientId } = args;
    const targetClientId = clientId || this.activeClientId;

    if (!targetClientId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active client available. Please ensure a browser client has taken ownership using mcpTakeOwnership()'
          }
        ]
      };
    }

    try {
      await this.sendWebSocketRequest('execute_code', { code }, targetClientId);
      
      return {
        content: [
          {
            type: 'text',
            text: `JavaScript execution command sent to client ${targetClientId}` +
                  `\nCode: ${code}` +
                  `\nTimestamp: ${new Date().toISOString()}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing JavaScript: ${error.message}`
          }
        ]
      };
    }
  }

  async queryElements(args) {
    const { selector, clientId } = args;
    const targetClientId = clientId || this.activeClientId;

    if (!targetClientId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active client available. Please ensure a browser client has taken ownership using mcpTakeOwnership()'
          }
        ]
      };
    }

    // Use Unix socket to communicate with web server
    const data = await this.unixSocket.sendMessage('web', 'query_elements', {
      selector,
      clientId: targetClientId
    }, 'mcp');

    return {
      content: [
        {
          type: 'text',
          text: `Element query command sent to client ${targetClientId}:\n\n` +
                `Selector: ${selector}\n\n` +
                `Command ID: ${data.timestamp}`
        }
      ]
    };
  }

  async triggerEvent(args) {
    const { selector, eventType, eventData, clientId } = args;
    const targetClientId = clientId || this.activeClientId;

    if (!targetClientId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active client available. Please ensure a browser client has taken ownership using mcpTakeOwnership()'
          }
        ]
      };
    }

    // Use Unix socket to communicate with web server
    const data = await this.unixSocket.sendMessage('web', 'trigger_event', {
      selector,
      eventType,
      eventData,
      clientId: targetClientId
    }, 'mcp');

    return {
      content: [
        {
          type: 'text',
          text: `Event trigger command sent to client ${targetClientId}:\n\n` +
                `Selector: ${selector}\n` +
                `Event Type: ${eventType}` +
                (eventData ? `\nEvent Data: ${JSON.stringify(eventData, null, 2)}` : '') +
                `\n\nCommand ID: ${data.timestamp}`
        }
      ]
    };
  }

  async sendCommand(args) {
    const { type, data, clientId } = args;
    const targetClientId = clientId || this.activeClientId;

    if (!targetClientId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active client available. Please ensure a browser client has taken ownership using mcpTakeOwnership()'
          }
        ]
      };
    }

    // Use Unix socket to communicate with web server
    const response = await this.unixSocket.sendMessage('web', 'send_command', {
      type,
      data,
      clientId: targetClientId
    }, 'mcp');

    return {
      content: [
        {
          type: 'text',
          text: `Custom command sent to client ${targetClientId}:\n\n` +
                `Type: ${type}` +
                (data ? `\nData: ${JSON.stringify(data, null, 2)}` : '') +
                `\n\nCommand ID: ${response.timestamp}`
        }
      ]
    };
  }

  async sendWebSocketRequest(type, data = {}, targetClientId = null) {
    return new Promise((resolve, reject) => {
      if (!this.devBridgeWs || this.devBridgeWs.readyState !== WebSocket.OPEN) {
        reject(new Error('Dev bridge WebSocket not connected'));
        return;
      }

      const requestId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const message = {
        type: 'mcp_request',
        requestId,
        requestType: type,
        data,
        targetClientId
      };

      const timeout = setTimeout(() => {
        reject(new Error(`WebSocket request timeout for ${type}`));
      }, 10000);

      const handleResponse = (response) => {
        if (response.requestId === requestId) {
          clearTimeout(timeout);
          this.devBridgeWs.removeListener('message', handleResponse);
          if (response.success) {
            resolve(response.data);
          } else {
            reject(new Error(response.error || 'WebSocket request failed'));
          }
        }
      };

      this.devBridgeWs.on('message', (data) => {
        try {
          const response = JSON.parse(data);
          handleResponse(response);
        } catch (error) {
          // Ignore non-JSON messages
        }
      });

      this.devBridgeWs.send(JSON.stringify(message));
    });
  }


  // PM2 Connection
  connectToPM2() {
    pm2.connect((err) => {
      if (err) {
        console.error('❌ Failed to connect to PM2:', err);
        return;
      }
      console.log('✅ Connected to PM2 daemon');
    });
  }

  // PM2 Management Methods
  async getPm2Status() {
    try {
      const pm2Id = config.devPm2Id || 12;
      
      return new Promise((resolve, reject) => {
        pm2.list((err, processes) => {
          if (err) {
            reject(new Error(`PM2 list failed: ${err.message}`));
            return;
          }
          
          const serverProcess = processes.find(p => p.pm_id === pm2Id);
          
          if (!serverProcess) {
            resolve({
              content: [
                {
                  type: 'text',
                  text: `PM2 process with ID ${pm2Id} not found`
                }
              ]
            });
            return;
          }
          
          const status = {
            id: serverProcess.pm_id,
            name: serverProcess.name,
            status: serverProcess.pm2_env?.status || 'unknown',
            uptime: serverProcess.pm2_env?.uptime || 0,
            restarts: serverProcess.pm2_env?.restart_time || 0,
            memory: serverProcess.monit?.memory || 0,
            cpu: serverProcess.monit?.cpu || 0,
            pid: serverProcess.pid || 'N/A',
            createdAt: serverProcess.pm2_env?.created_at || 'N/A'
          };
          
          resolve({
            content: [
              {
                type: 'text',
                text: `PM2 Server Status (ID: ${pm2Id}):\n\n` +
                      `Name: ${status.name}\n` +
                      `Status: ${status.status}\n` +
                      `PID: ${status.pid}\n` +
                      `Uptime: ${Math.floor(status.uptime / 1000)}s\n` +
                      `Restarts: ${status.restarts}\n` +
                      `Memory: ${Math.round(status.memory / 1024 / 1024)}MB\n` +
                      `CPU: ${status.cpu}%\n` +
                      `Created: ${new Date(status.createdAt).toISOString()}`
              }
            ]
          });
        });
      });
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting PM2 status: ${error.message}`
          }
        ]
      };
    }
  }

  async getPm2Logs(args) {
    try {
      const pm2Id = config.devPm2Id || 12;
      const lines = args?.lines || 100;
      const type = args?.type || 'combined';
      const fs = require('fs');
      
      return new Promise((resolve, reject) => {
        pm2.describe(pm2Id, (err, processDescription) => {
          if (err) {
            reject(new Error(`PM2 describe failed: ${err.message}`));
            return;
          }
          
          if (!processDescription || processDescription.length === 0) {
            reject(new Error(`PM2 process with ID ${pm2Id} not found`));
            return;
          }
          
          const process = processDescription[0];
          const logPaths = {
            out: process.pm2_env?.pm_out_log_path,
            err: process.pm2_env?.pm_err_log_path
          };
          
          let logs = '';
          
          const readLogFile = (filePath, logType) => {
            if (!filePath || !fs.existsSync(filePath)) {
              return '';
            }
            
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              const logLines = content.split('\n');
              const recentLines = logLines.slice(-lines);
              return recentLines.join('\n');
            } catch (error) {
              console.warn(`Failed to read ${logType} log file: ${error.message}`);
              return '';
            }
          };
          
          if (type === 'combined' || type === 'out') {
            const outLogs = readLogFile(logPaths.out, 'out');
            if (outLogs) {
              logs += `=== STDOUT ===\n${outLogs}\n`;
            }
          }
          
          if (type === 'combined' || type === 'err') {
            const errLogs = readLogFile(logPaths.err, 'err');
            if (errLogs) {
              if (logs) logs += '\n';
              logs += `=== STDERR ===\n${errLogs}`;
            }
          }
          
          if (!logs.trim()) {
            logs = 'No logs available';
          }
          
          resolve({
            content: [
              {
                type: 'text',
                text: `PM2 Logs (ID: ${pm2Id}, Type: ${type}, Lines: ${lines}):\n\n${logs}`
              }
            ]
          });
        });
      });
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting PM2 logs: ${error.message}`
          }
        ]
      };
    }
  }

  async restartPm2Server() {
    try {
      const pm2Id = config.devPm2Id || 12;
      
      return new Promise((resolve, reject) => {
        pm2.restart(pm2Id, (err, proc) => {
          if (err) {
            reject(new Error(`PM2 restart failed: ${err.message}`));
            return;
          }
          
          resolve({
            content: [
              {
                type: 'text',
                text: `PM2 Server restarted successfully (ID: ${pm2Id})\n\nProcess: ${proc.name || 'Unknown'}`
              }
            ]
          });
        });
      });
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error restarting PM2 server: ${error.message}`
          }
        ]
      };
    }
  }

  async stopPm2Server() {
    try {
      const pm2Id = config.devPm2Id || 12;
      
      return new Promise((resolve, reject) => {
        pm2.stop(pm2Id, (err, proc) => {
          if (err) {
            reject(new Error(`PM2 stop failed: ${err.message}`));
            return;
          }
          
          resolve({
            content: [
              {
                type: 'text',
                text: `PM2 Server stopped successfully (ID: ${pm2Id})\n\nProcess: ${proc.name || 'Unknown'}`
              }
            ]
          });
        });
      });
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error stopping PM2 server: ${error.message}`
          }
        ]
      };
    }
  }

  async startPm2Server() {
    try {
      const pm2Id = config.devPm2Id || 12;
      
      return new Promise((resolve, reject) => {
        pm2.start(pm2Id, (err, proc) => {
          if (err) {
            reject(new Error(`PM2 start failed: ${err.message}`));
            return;
          }
          
          resolve({
            content: [
              {
                type: 'text',
                text: `PM2 Server started successfully (ID: ${pm2Id})\n\nProcess: ${proc.name || 'Unknown'}`
              }
            ]
          });
        });
      });
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error starting PM2 server: ${error.message}`
          }
        ]
      };
    }
  }

  async makePostRequest(endpoint, data) {
    try {
      const response = await axios.post(`${this.baseUrl}${endpoint}`, data, {
        headers: {
          'Authorization': `Bearer ${this.authKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`HTTP ${error.response.status}: ${error.response.data?.message || error.response.statusText}`);
      } else if (error.request) {
        throw new Error('Network error: No response received');
      } else {
        throw new Error(`Request error: ${error.message}`);
      }
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('StaticForge MCP Server running on stdio');
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('🛑 Shutting down MCP Server...');
      this.unixSocket.close();
      pm2.disconnect(() => {
        process.exit(0);
      });
    });
  }
}

// Run the server
const server = new StaticForgeMCPServer();
server.run().catch(console.error);

