/**
 * Mainframe exception dialog (Yozora #434): on the desktop a WebSocket server error is no longer
 * a toast but a .NET-style "Unhandled exception" window (the WinForms ThreadExceptionDialog):
 *
 *   Melaton Framework
 *   [x]  Unhandled exception has occurred in a component in your application. If you click
 *        Continue, the application will ignore this error and attempt to continue. If you click
 *        Quit, the application will close immediately.
 *
 *        Dreamscape Mainframe Server Exception: Illegal Operation in Packet.
 *   [Details ▼]                                                  [Continue] [Quit]
 *
 * translateServerError() turns the server's { message, details, code } into Windows language
 * ("Unknown message type" → Illegal Operation in Packet); Details shows the exception text,
 * the packet and the connection like .NET's exception report. Quit restarts through /launch
 * (restartClientNavigate, modalUtils.js). Errors that arrive while it is open are added to the
 * report ("+N more") instead of stacking windows.
 *
 *   mainframeExceptionDialog.show(errorPacket) / close() / isOpen()
 *   mainframeExceptionDialog.translateServerError(errorPacket) → { exception, text }
 */
(function (root) {
    'use strict';

    const INTRO = 'Unhandled exception has occurred in a component in your application. If you click Continue, '
        + 'the application will ignore this error and attempt to continue. If you click Quit, the application '
        + 'will close immediately.';

    /** [test, exception class, Windows wording] — first match wins. */
    const TRANSLATIONS = [
        [(m) => /unknown message type/i.test(m.message), 'IllegalPacketOperationException', 'Illegal Operation in Packet'],
        [(m) => /invalid message format|parse/i.test(m.message), 'MalformedPacketException', 'Malformed Packet'],
        [(m) => /packet handler failed/i.test(m.message), 'PacketHandlerFaultException', 'Packet Handler Fault'],
        [(m) => m.code === 'AUTH_REQUIRED' || /authentication required|not authenticated/i.test(m.message),
            'UnauthorizedAccessException', 'Access Denied'],
        [(m) => m.code === 'READONLY_RESTRICTED' || m.code === 'INSUFFICIENT_SCOPE' || /not allowed|forbidden|scope/i.test(m.message),
            'SecurityException', 'Operation Not Permitted'],
        [(m) => /rate limit|too many|busy/i.test(m.message), 'ServerBusyException', 'Server Busy'],
        [(m) => /time(d)? ?out/i.test(m.message), 'TimeoutException', 'Operation Timed Out'],
        [(m) => /not found|no such|does not exist/i.test(m.message), 'ObjectNotFoundException', 'Object Not Found'],
        [(m) => /invalid|missing|required|must be/i.test(m.message), 'ArgumentException', 'Invalid Argument in Packet']
    ];

    function translateServerError(packet) {
        const m = { message: String((packet && packet.message) || ''), code: packet && packet.code };
        for (const [test, exception, text] of TRANSLATIONS) {
            if (test(m)) return { exception, text };
        }
        return { exception: 'InternalServerException', text: 'Internal Error' };
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function stamp(date) {
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
            + `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    }

    function connectionLines() {
        const net = root.melatonNetworkDialogs;
        if (!net) return [];
        const info = net.connectionInfo();
        return [
            `Domain: ${info.domain}`,
            `Connection: ${info.connectionName} (${net.miniportLabel(info)})`,
            `Server: ${info.fqdn}`
        ];
    }

    /** The .NET-style exception report for one or more server errors (newest last). */
    function buildReport(entries) {
        const lines = [
            'See the end of this message for details on reporting',
            'this exception instead of this dialog box.',
            ''
        ];
        entries.forEach((entry, i) => {
            const { packet, translated, at, repeats } = entry;
            const packetType = packet.requestType || (packet.message && /unknown message type/i.test(packet.message) ? packet.details : null);
            lines.push(`************** Exception Text${entries.length > 1 ? ` (${i + 1} of ${entries.length})` : ''} **************`);
            lines.push(`Dreamscape.Mainframe.${translated.exception}: ${translated.text}`);
            lines.push(`   Server message: ${packet.message || '(none)'}`);
            if (packet.details && packet.details !== packet.message) lines.push(`   Details: ${packet.details}`);
            lines.push('   at Dreamscape.Mainframe.PacketRouter.Dispatch(Packet packet)');
            lines.push('   at Dreamscape.Mainframe.Session.Receive(Socket socket)');
            lines.push(`   at Melaton.Net.WebSocketClient.Send(String type = "${packetType || 'unknown'}")`);
            lines.push('');
            lines.push('************** Packet **************');
            lines.push(`Type: ${packetType || '(not a request)'}`);
            lines.push(`Request ID: ${packet.requestId || '(none)'}`);
            lines.push(`Code: ${packet.code || '(none)'}`);
            lines.push(`Received: ${stamp(at)}${repeats > 1 ? ` (${repeats} times)` : ''}`);
            lines.push('');
        });
        const conn = connectionLines();
        if (conn.length) {
            lines.push('************** Connection **************');
            lines.push(...conn);
            lines.push('');
        }
        lines.push('************** Reporting **************');
        lines.push('Copy this text into a Yozora issue to report the exception. The packet');
        lines.push('was rejected by the domain controller; the session is still connected.');
        return lines.join('\n');
    }

    // ---- the dialog --------------------------------------------------------------------------

    const doc = typeof document !== 'undefined' ? document : null;
    let modal = null;
    let entries = [];

    function el(selector) {
        return modal ? modal.querySelector(selector) : null;
    }

    function errorIcon() {
        const box = root.bootMessageBox;
        return box && box.ICONS ? box.ICONS.error : '';
    }

    function ensureModal() {
        if (modal || !doc) return modal;
        modal = doc.createElement('div');
        modal.id = 'mainframeExceptionDialog';
        modal.className = 'modal hidden on-top vpn-dialog dotnet-exception-modal';
        // ThreadExceptionDialog has no caption icon; its taskbar button still gets one (modalUtils.js)
        modal.dataset.captionIcon = 'none';
        modal.dataset.windowRestorePosition = 'false';
        modal.dataset.windowRestoreSize = 'false';
        modal.setAttribute('role', 'alertdialog');
        modal.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main"><span>Melaton Framework</span></div>
            </div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-danger close-btn btn-small dotnet-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content vpn-dialog-content dotnet-content">
                <div class="dotnet-main">
                    <div class="dotnet-icon" aria-hidden="true"></div>
                    <div class="dotnet-text">
                        <p class="dotnet-intro"></p>
                        <p class="dotnet-message"></p>
                    </div>
                </div>
                <div class="dotnet-buttons">
                    <button type="button" class="btn-standard dotnet-details-btn" aria-expanded="false"><u>D</u>etails <span class="dotnet-arrow">&#9660;</span></button>
                    <span class="dotnet-more"></span>
                    <button type="button" class="btn-standard dotnet-continue"><u>C</u>ontinue</button>
                    <button type="button" class="btn-standard dotnet-quit"><u>Q</u>uit</button>
                </div>
                <textarea class="dotnet-details hidden" readonly wrap="off" spellcheck="false" aria-label="Exception details"></textarea>
            </div>`;
        doc.body.appendChild(modal);
        el('.dotnet-intro').textContent = INTRO;
        el('.dotnet-icon').innerHTML = errorIcon();
        el('.dotnet-continue').addEventListener('click', close);
        el('.dotnet-close').addEventListener('click', close);
        el('.dotnet-quit').addEventListener('click', quit);
        el('.dotnet-details-btn').addEventListener('click', toggleDetails);
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                close();
            }
        });
        return modal;
    }

    function isOpen() {
        return !!(modal && !modal.classList.contains('hidden') && !modal.classList.contains('closing'));
    }

    function render() {
        const first = entries[0];
        el('.dotnet-message').textContent = `Dreamscape Mainframe Server Exception: ${first.translated.text}.`;
        const more = entries.reduce((n, e) => n + e.repeats, 0) - 1;
        el('.dotnet-more').textContent = more > 0 ? `+${more} more` : '';
        el('.dotnet-details').value = buildReport(entries);
    }

    function toggleDetails() {
        const details = el('.dotnet-details');
        const open = details.classList.toggle('hidden') === false;
        el('.dotnet-details-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
        el('.dotnet-arrow').innerHTML = open ? '&#9650;' : '&#9660;';
        if (open) details.scrollTop = 0;
    }

    function show(packet) {
        if (!ensureModal() || !packet) return;
        const translated = translateServerError(packet);
        const same = entries.find((e) => e.packet.message === packet.message && e.packet.details === packet.details
            && (e.packet.requestType || null) === (packet.requestType || null));
        if (same && isOpen()) {
            same.repeats++;
            same.at = new Date();
        } else {
            if (!isOpen()) entries = [];
            entries.push({ packet, translated, at: new Date(), repeats: 1 });
        }
        render();
        if (!isOpen()) {
            el('.dotnet-details').classList.add('hidden');
            el('.dotnet-details-btn').setAttribute('aria-expanded', 'false');
            el('.dotnet-arrow').innerHTML = '&#9660;';
            // desktopSounds.play: public/scripts/comp/desktopSounds.js
            desktopSounds.play('critical-stop');
            if (typeof root.openModal === 'function') root.openModal(modal);
            else modal.classList.remove('hidden');
            setTimeout(() => {
                const btn = el('.dotnet-continue');
                if (btn) btn.focus();
            }, 0);
        }
    }

    function close() {
        entries = [];
        if (!modal) return;
        if (typeof root.closeModal === 'function') root.closeModal(modal);
        else modal.classList.add('hidden');
    }

    function quit() {
        close();
        // runWinlogonPower: public/scripts/comp/winlogonPower.js
        if (typeof root.runWinlogonPower === 'function') root.runWinlogonPower('restart');
        else if (typeof root.restartClientNavigate === 'function') root.restartClientNavigate();
        else if (root.location) root.location.reload();
    }

    const api = { show, close, isOpen, translateServerError, buildReport, INTRO };
    if (root) root.mainframeExceptionDialog = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
