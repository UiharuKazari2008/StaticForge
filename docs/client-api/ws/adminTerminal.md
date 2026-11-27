# Administrator Terminal (WebSocket)

Raw `bash -l` on the server, as the server's user, in a pty (node-pty), for the desktop's xterm.js window
(Yozora #1133). Server: `modules/adminTerminal.js`, packets in `modules/ws/handlers/320-adminTerminalHandler.js`.
Client: `public/scripts/comp/desktop-apps/adminTerminal/adminTerminalApp.js`.

## Who may use it

Every packet below is refused with `error` (`details: INSUFFICIENT_PERMISSIONS`) unless the connection is an
**administrator with a full sign-in**: `userType === 'admin'`, authenticated by the session cookie (a PIN or the
loopback dev login), with no application key (`applicationAuth`, `authMethod` `application_key` /
`trusted_keyless`, key scopes), no replication token, and a stored session that is not an approved-IP or
client-certificate sign-in. The stored session is read again at `admin_terminal_open` and at most every 10 s
after. Nothing is spawned for a refused client.

**CaféReady (certificate sign-in).** An administrator's client-certificate session is refused with
`details: ADMIN_PIN_REQUIRED` until the administrator PIN is typed in the terminal window (`admin_terminal_pin`,
below; no echo). The server stores `adminPinAt` on that session, so the PIN is asked once per sign-in; a Log off /
logon regenerates the session and asks again. Five wrong PINs lock it for 15 minutes (`PIN_LOCKED`). Approved-IP
and application-key sign-ins are never let in. This is the WebSocket form of `guacFullSession`
(`req.userType === 'admin' && !req.applicationAuth`, `modules/guacRemoteBridge.js`). What is typed or printed
is never logged.

## Sessions

A terminal belongs to the connection that opened it (another connection cannot type into, resize, ack or close
it). It ends when the client sends `admin_terminal_close`, when the socket closes, when the shell exits, and when
Dreamscape exits. At most 4 per sign-in (`TOO_MANY`). `id` is chosen by the client: `[A-Za-z0-9_-]{1,40}`.
Environment: `HOME` as the working directory, `TERM=xterm-256color`, `COLORTERM=truecolor`, `LANG`, `PATH`;
the server's own variables (keys, pm2) are not passed.

## Client to server

| Packet | Fields | Reply |
| --- | --- | --- |
| `admin_terminal_open` | `id`, `cols` (2-500, default 80), `rows` (1-200, default 25), `claudeSession` (optional: a running Fleet session's id; the terminal is then `tmux attach` to that session's pane instead of bash, for Fleet's Show Screen; closing it only detaches), `requestId` | `admin_terminal_open_response` `{ success, id, pid, cols, rows, title? }` (`title`: the attached tmux session's name), or `error` (`BAD_ID`, `DUPLICATE`, `TOO_MANY`, `INSUFFICIENT_PERMISSIONS`) |
| `admin_terminal_pin` | `pin`, `requestId` (only on a certificate session that `admin_terminal_open` answered with `ADMIN_PIN_REQUIRED`) | `admin_terminal_pin_response` `{ success }`, or `error` (`BAD_PIN`, `PIN_LOCKED`, `INSUFFICIENT_PERMISSIONS`) |
| `admin_terminal_input` | `id`, `data` (string, at most 256 K characters: keys typed or pasted) | none |
| `admin_terminal_resize` | `id`, `cols`, `rows` (send after every fit; passed to the pty) | none |
| `admin_terminal_ack` | `id`, `chars` (output characters xterm has written) | none |
| `admin_terminal_close` | `id` | none (the shell gets SIGHUP, SIGKILL for its group after 2 s) |

All six are dispatched `fifo` per connection, so keys and resizes keep their order.

## Server to client (pushes, to the owner's socket only)

| Packet | Data |
| --- | --- |
| `admin_terminal_output` | `{ id, data }`: output gathered for about 12 ms or 32 KB per packet |
| `admin_terminal_exit` | `{ id, exitCode, signal }`: the shell ended; the client shows `[Process exited]` and closes the window |

## Flow control

The server counts the characters it sent that are not acked. Above 256 K it pauses the pty (the shell blocks on a
full pty buffer, nothing piles up in the server or the socket); at 64 K or less it resumes. The client sends
`admin_terminal_ack` when xterm has written the output (`term.write(data, callback)`), coalesced to one ack per
idle write queue or 32 K.
