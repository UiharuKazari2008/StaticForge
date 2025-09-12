const net = require('net');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class UnixSocketCommunication extends EventEmitter {
  constructor(options = {}) {
    super();
    this.socketPath = options.socketPath || '/tmp/staticforge_mcp.sock';
    this.server = null;
    this.client = null;
    this.isServer = false;
    this.isClient = false;
    this.messageId = 0;
    this.pendingMessages = new Map();
    this.messageTimeout = options.messageTimeout || 30000; // 30 seconds
    this.connectedClients = new Map(); // Track connected clients for responses
  }

  // Start as server (web server)
  startServer() {
    return new Promise((resolve, reject) => {
      // Remove existing socket file if it exists
      if (fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }

      this.server = net.createServer((socket) => {
        const clientId = Date.now().toString();
        this.connectedClients.set(clientId, socket);
        console.log('🔌 Unix socket client connected:', clientId);
        
        socket.on('data', (data) => {
          try {
            const messages = data.toString().split('\n').filter(msg => msg.trim());
            messages.forEach(rawMessage => {
              const message = JSON.parse(rawMessage);
              this.handleIncomingMessage(message, socket);
            });
          } catch (error) {
            console.error('❌ Error parsing socket message:', error);
          }
        });

        socket.on('close', () => {
          this.connectedClients.delete(clientId);
          console.log('🔌 Unix socket client disconnected:', clientId);
        });

        socket.on('error', (error) => {
          this.connectedClients.delete(clientId);
          console.error('❌ Unix socket error:', error);
        });
      });

      this.server.listen(this.socketPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.isServer = true;
        console.log(`✅ Unix socket server listening on ${this.socketPath}`);
        resolve();
      });

      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.log('🔄 Socket in use, removing and retrying...');
          fs.unlinkSync(this.socketPath);
          this.server.close();
          this.startServer().then(resolve).catch(reject);
        } else {
          reject(error);
        }
      });
    });
  }

  // Start as client (MCP server)
  startClient() {
    return new Promise((resolve, reject) => {
      this.client = new net.Socket();
      
      this.client.connect(this.socketPath, () => {
        this.isClient = true;
        console.log(`✅ Unix socket client connected to ${this.socketPath}`);
        resolve();
      });

      this.client.on('data', (data) => {
        try {
          const messages = data.toString().split('\n').filter(msg => msg.trim());
          messages.forEach(rawMessage => {
            const message = JSON.parse(rawMessage);
            this.handleIncomingMessage(message);
          });
        } catch (error) {
          console.error('❌ Error parsing socket response:', error);
        }
      });

      this.client.on('close', () => {
        console.log('🔌 Unix socket connection closed');
        this.isClient = false;
      });

      this.client.on('error', (error) => {
        console.error('❌ Unix socket client error:', error);
        this.isClient = false;
        reject(error);
      });
    });
  }

  // Send message to server (client -> server)
  async sendMessage(target, type, data, source) {
    if (!this.isClient) {
      throw new Error('Not connected as client');
    }

    const messageId = ++this.messageId;
    const message = {
      id: messageId,
      type,
      data,
      source,
      target,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(messageId);
        reject(new Error(`Message timeout: ${type}`));
      }, this.messageTimeout);

      // Store pending message
      this.pendingMessages.set(messageId, { resolve, reject, timeout });

      // Send message
      try {
        this.client.write(JSON.stringify(message) + '\n');
      } catch (error) {
        clearTimeout(timeout);
        this.pendingMessages.delete(messageId);
        reject(error);
      }
    });
  }

  // Send response to client (server -> client)
  sendResponse(messageId, data, error, success) {
    if (!this.isServer) {
      throw new Error('Not running as server');
    }

    const response = {
      id: messageId,
      type: 'response',
      data,
      error,
      success,
      timestamp: Date.now()
    };

    // Broadcast to all connected clients
    this.server.getConnections((err, count) => {
      if (err) {
        console.error('❌ Error getting connections:', err);
        return;
      }
      
      // For now, we'll store the response and let the client handle it
      // In a real implementation, you'd track which client sent the original message
      this.emit('response', response);
    });
  }

  // Send response to specific client
  sendResponseToClient(socket, messageId, data, error, success) {
    const response = {
      id: messageId,
      type: 'response',
      data,
      error,
      success,
      timestamp: Date.now()
    };

    try {
      socket.write(JSON.stringify(response) + '\n');
    } catch (err) {
      console.error('❌ Error sending response:', err);
    }
  }

  // Handle incoming messages
  handleIncomingMessage(message, socket = null) {
    if (message.type === 'response') {
      // Handle response from server
      const pending = this.pendingMessages.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingMessages.delete(message.id);
        
        if (message.success) {
          pending.resolve(message.data);
        } else {
          pending.reject(new Error(message.error || 'Unknown error'));
        }
      }
    } else {
      // Handle request from client - emit message with socket reference
      this.emit('message', message, socket);
    }
  }

  // Send response back to client (server side)
  sendResponseToClient(socket, messageId, data, error, success) {
    const response = {
      id: messageId,
      type: 'response',
      data,
      error,
      success,
      timestamp: Date.now()
    };

    try {
      socket.write(JSON.stringify(response) + '\n');
    } catch (err) {
      console.error('❌ Error sending response:', err);
    }
  }

  // Close connections
  close() {
    if (this.server) {
      this.server.close(() => {
        console.log('🔌 Unix socket server closed');
        // Remove socket file
        if (fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath);
        }
      });
    }

    if (this.client) {
      this.client.destroy();
      console.log('🔌 Unix socket client closed');
    }

    // Clear pending messages
    this.pendingMessages.forEach(({ timeout }) => clearTimeout(timeout));
    this.pendingMessages.clear();
  }

  // Get connection status
  isConnected() {
    return this.isServer || this.isClient;
  }

  // Get connection info
  getConnectionInfo() {
    return {
      isServer: this.isServer,
      isClient: this.isClient,
      socketPath: this.socketPath,
      connected: this.isConnected()
    };
  }
}

module.exports = UnixSocketCommunication;
