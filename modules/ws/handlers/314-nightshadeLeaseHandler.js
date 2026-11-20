const wsPacketRegistry = require('../wsPacketRegistry');
const pool = require('../../nightshadeAddressPool');

// The Nightshade Network's DHCP (Yozora #952): a client's Café Miniport / Nightshade adapter asks for its address when
// its connection comes up (each connect, as a DHCP client does when its link comes up; no timer), and keeps it for the
// adapter's Status > Details and ipconfig. The address is kept on the connection for the client lists (Server Manager
// > Clients: server_clients rows' nightshadeIp, agentClientBridge).
//
//   nightshade_dhcp { nic, host } -> { success, lease: { nic, ip, mask, prefix, gateway, dhcpServer, dns, obtainedAt,
//                                      expiresAt, domain } }
//     nic     the adapter's physical address (12 hex digits; the page makes it once and keeps it)
//     host    the computer's name (melatonDeviceIdentity / the browser), for the server's lists
//     domain  the server's FQDN (config public_hostname): the adapter's Connection-specific DNS Suffix
//
// Signed-in clients only. Miniport sub-clients of one app share the app's storage, so a phone and its DeX window send
// the same nic and hold one address.

function fqdn(handlersCtx) {
    try {
        const gr = handlersCtx.globalResources;
        return String((gr && gr.getConfig({ path: 'public_hostname' })) || '').trim().toLowerCase();
    } catch (_) { return ''; }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    wsPacketRegistry.registerWsPacket('nightshade_dhcp', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        const d = message.data || message;
        let data;
        if (!clientInfo || !clientInfo.authenticated) data = { success: false, error: 'Sign in first.' };
        else {
            const lease = pool.lease({ nic: d.nic, host: d.host, user: clientInfo.userType, clientId: clientInfo.clientId });
            if (!lease) data = { success: false, error: 'The adapter address is not valid.' };
            else {
                clientInfo.nightshadeLease = { ip: lease.ip, nic: lease.nic, host: lease.host };
                data = { success: true, lease: { ...lease, domain: fqdn(handlersCtx) } };
                try { require('./307-serverManagerHandler').pokeClients(); } catch (_) { /* the list refreshes on its own */ }
            }
        }
        handlersCtx.sendToClient(ws, { type: 'nightshade_dhcp_response', requestId: message.requestId, data, timestamp: new Date().toISOString() });
    }, { owner: 'nightshadeLease' });
}

module.exports = { registerPackets };
