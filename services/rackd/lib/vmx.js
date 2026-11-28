'use strict';
// vmx: pure helpers for the vms role: libvirt XML edits, the domain XML rackd builds, QMP key tables.
const path = require('path');

const LOG_DIR = '/var/lib/rackd/vm-logs';
const logPath = name => path.join(LOG_DIR, `${name}.log`);
const attr = (x, tag, a) => { const m = x.match(new RegExp(`<${tag}\\b[^>]*\\b${a}='([^']*)'`)); return m ? m[1] : null; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');
const devices = xml => (xml.match(/<devices>([\s\S]*)<\/devices>/) || [])[1] || '';
const addDevice = (xml, frag) => xml.replace('</devices>', `    ${frag}\n  </devices>`);

/** Disk blocks of the XML: [{ block, device, target, bus, source, format, readonly, type }]. */
function disks(xml) {
  return [...xml.matchAll(/<disk\b[\s\S]*?<\/disk>/g)].map(m => {
    const b = m[0];
    return { block: b, device: attr(b, 'disk', 'device') || 'disk', type: attr(b, 'disk', 'type'), target: attr(b, 'target', 'dev'), bus: attr(b, 'target', 'bus'),
      source: attr(b, 'source', 'file') || attr(b, 'source', 'dev') || attr(b, 'source', 'name'), format: attr(b, 'driver', 'type'), readonly: /<readonly\s*\/>/.test(b) };
  });
}
/** The next free target name for a bus: vdX for virtio, sdX for scsi and sata (one namespace). */
function nextTarget(xml, bus) {
  const pre = bus === 'virtio' ? 'vd' : 'sd';
  const used = new Set(disks(xml).map(d => d.target));
  for (let i = 0; i < 26; i++) { const t = pre + String.fromCharCode(97 + i); if (!used.has(t)) return t; }
  throw new Error('no free disk target');
}

/** Makes the XML manageable: VNC on 127.0.0.1, the guest agent channel, a serial console log file, a USB tablet. Returns { xml, added:[...] }. */
function ensureDevices(xml0, name) {
  let xml = xml0; const added = [];
  if (!/<graphics\b[^>]*type='vnc'/.test(xml)) {
    xml = addDevice(xml, "<graphics type='vnc' port='-1' autoport='yes' listen='127.0.0.1'><listen type='address' address='127.0.0.1'/></graphics>"); added.push('vnc');
  } else {
    xml = xml.replace(/<graphics\b[^>]*type='vnc'[^>]*>/, g => { const n = g.replace(/\blisten='[^']*'/, "listen='127.0.0.1'"); return /listen=/.test(n) ? n : n.replace('<graphics', "<graphics listen='127.0.0.1'"); });
    xml = xml.replace(/(<graphics\b[^>]*type='vnc'[\s\S]*?)<listen\b[^>]*address='[^']*'/, "$1<listen type='address' address='127.0.0.1'");
  }
  if (!/org\.qemu\.guest_agent\.0/.test(xml)) { xml = addDevice(xml, "<channel type='unix'><target type='virtio' name='org.qemu.guest_agent.0'/></channel>"); added.push('guest-agent-channel'); }
  const lp = logPath(name);
  if (!new RegExp(`<serial\\b[^>]*type='file'[\\s\\S]*?<source\\b[^>]*path='${lp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(xml)) {
    xml = xml.replace(/<serial\b[\s\S]*?<\/serial>\s*/g, '').replace(/<serial\b[^>]*\/>\s*/g, '').replace(/<console\b[\s\S]*?<\/console>\s*/g, '').replace(/<console\b[^>]*\/>\s*/g, '');
    xml = addDevice(xml, `<serial type='file'><source path='${esc(lp)}' append='on'/><target type='isa-serial' port='0'><model name='isa-serial'/></target></serial>\n    <console type='file'><source path='${esc(lp)}' append='on'/><target type='serial' port='0'/></console>`);
    added.push('serial-log');
  }
  if (!/<input\b[^>]*type='tablet'/.test(xml)) { xml = addDevice(xml, "<input type='tablet' bus='usb'/>"); added.push('tablet'); }
  return { xml, added };
}

/** The XML of a new virtual machine (what New Virtual Machine builds). o: { name, vcpus, memMB, maxMemMB?, uefi, secureBoot, tpm, cpuModel, disks:[{path,bus,format}], iso, network|bridge, mac, guest, boot:[...] } */
function buildXml(o) {
  const cpu = !o.cpuModel || o.cpuModel === 'host-passthrough' ? "<cpu mode='host-passthrough' check='none' migratable='on'/>"
    : o.cpuModel === 'host-model' ? "<cpu mode='host-model'/>" : `<cpu mode='custom' match='exact'><model fallback='forbid'>${esc(o.cpuModel)}</model></cpu>`;
  const maxKi = Math.round((o.maxMemMB || o.memMB) * 1024), curKi = Math.round(o.memMB * 1024);
  const sb = !!(o.uefi && o.secureBoot);
  const os = o.uefi
    ? `<os firmware='efi'><type arch='x86_64' machine='q35'>hvm</type><firmware><feature enabled='${sb ? 'yes' : 'no'}' name='enrolled-keys'/><feature enabled='${sb ? 'yes' : 'no'}' name='secure-boot'/></firmware></os>`
    : "<os><type arch='x86_64' machine='q35'>hvm</type></os>";
  let dev = '';
  let scsi = false; const taken = []; let order = 0;
  const bootOrder = (o.boot && o.boot.length ? o.boot : (o.iso ? ['cdrom', 'disk', 'network'] : ['disk', 'cdrom', 'network']));
  const ord = kind => { const i = bootOrder.indexOf(kind); return i >= 0 ? `<boot order='${i + 1}'/>` : ''; };
  let firstDisk = true;
  for (const d of o.disks || []) {
    const t = nextTarget(`<devices>${taken.join('')}</devices>`, d.bus);
    if (d.bus === 'scsi') scsi = true;
    const blk = `<disk type='file' device='disk'><driver name='qemu' type='${d.format || 'qcow2'}' discard='unmap'/><source file='${esc(d.path)}'/><target dev='${t}' bus='${d.bus}'/>${firstDisk ? ord('disk') : ''}</disk>`;
    firstDisk = false; taken.push(`<target dev='${t}'/>`); dev += `    ${blk}\n`;
  }
  if (o.iso !== undefined) {
    const t = nextTarget(`<devices>${taken.join('')}</devices>`, 'sata'); taken.push(`<target dev='${t}'/>`);
    dev += `    <disk type='file' device='cdrom'><driver name='qemu' type='raw'/>${o.iso ? `<source file='${esc(o.iso)}'/>` : ''}<target dev='${t}' bus='sata'/><readonly/>${ord('cdrom')}</disk>\n`;
  }
  if (scsi) dev += "    <controller type='scsi' model='virtio-scsi'/>\n";
  const net = o.network ? (o.isBridge ? `<interface type='bridge'><source bridge='${esc(o.network)}'/>` : `<interface type='network'><source network='${esc(o.network)}'/>`) : null;
  if (net) dev += `    ${net}${o.mac ? `<mac address='${o.mac}'/>` : ''}<model type='virtio'/>${ord('network')}</interface>\n`;
  void order;
  dev += "    <controller type='usb' model='qemu-xhci'/>\n    <video><model type='vga' vram='16384' heads='1' primary='yes'/></video>\n    <memballoon model='virtio'/>\n    <rng model='virtio'><backend model='random'>/dev/urandom</backend></rng>\n";
  if (o.tpm) dev += "    <tpm model='tpm-crb'><backend type='emulator' version='2.0'/></tpm>\n";
  const xml = `<domain type='kvm'>
  <name>${esc(o.name)}</name>
  <memory unit='KiB'>${maxKi}</memory>
  <currentMemory unit='KiB'>${curKi}</currentMemory>
  <vcpu placement='static'>${o.vcpus}</vcpu>
  ${os}
  <features><acpi/><apic/>${sb ? "<smm state='on'/>" : ''}</features>
  ${cpu}
  <clock offset='${o.guest === 'windows' ? 'localtime' : 'utc'}'><timer name='rtc' tickpolicy='catchup'/><timer name='pit' tickpolicy='delay'/><timer name='hpet' present='no'/></clock>
  <on_poweroff>destroy</on_poweroff><on_reboot>restart</on_reboot><on_crash>destroy</on_crash>
  <pm><suspend-to-mem enabled='no'/><suspend-to-disk enabled='no'/></pm>
  <devices>
    <emulator>/usr/bin/qemu-system-x86_64</emulator>
${dev}  </devices>
</domain>
`;
  return ensureDevices(xml, o.name).xml;
}

// ---- QMP keys ---------------------------------------------------------------------------------------------
const ALIAS = { enter: 'ret', return: 'ret', space: 'spc', escape: 'esc', del: 'delete', control: 'ctrl', ctl: 'ctrl', win: 'meta_l', super: 'meta_l', windows: 'meta_l', cmd: 'meta_l', meta: 'meta_l',
  pageup: 'pgup', pagedown: 'pgdn', page_up: 'pgup', page_down: 'pgdn', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', backspace: 'backspace', bksp: 'backspace',
  altgr: 'alt_r', capslock: 'caps_lock', printscreen: 'print', ins: 'insert' };
const NAMED = new Set(['ctrl', 'alt', 'shift', 'ret', 'spc', 'tab', 'esc', 'backspace', 'delete', 'insert', 'home', 'end', 'pgup', 'pgdn', 'up', 'down', 'left', 'right', 'meta_l', 'meta_r', 'alt_r', 'ctrl_r', 'shift_r',
  'caps_lock', 'num_lock', 'scroll_lock', 'print', 'sysrq', 'menu', 'minus', 'equal', 'bracket_left', 'bracket_right', 'backslash', 'semicolon', 'apostrophe', 'grave_accent', 'comma', 'dot', 'slash']);
function qcode(k) {
  let s = String(k).toLowerCase();
  s = ALIAS[s] || s;
  if (/^[a-z0-9]$/.test(s) || /^f([1-9]|1[0-2])$/.test(s) || NAMED.has(s)) return s;
  throw new Error(`unknown key "${k}"`);
}
const SYM = { ' ': ['spc'], '\n': ['ret'], '\t': ['tab'], '-': ['minus'], '=': ['equal'], '[': ['bracket_left'], ']': ['bracket_right'], '\\': ['backslash'], ';': ['semicolon'], "'": ['apostrophe'], '`': ['grave_accent'], ',': ['comma'], '.': ['dot'], '/': ['slash'],
  '_': ['minus', 1], '+': ['equal', 1], '{': ['bracket_left', 1], '}': ['bracket_right', 1], '|': ['backslash', 1], ':': ['semicolon', 1], '"': ['apostrophe', 1], '~': ['grave_accent', 1], '<': ['comma', 1], '>': ['dot', 1], '?': ['slash', 1],
  '!': ['1', 1], '@': ['2', 1], '#': ['3', 1], '$': ['4', 1], '%': ['5', 1], '^': ['6', 1], '&': ['7', 1], '*': ['8', 1], '(': ['9', 1], ')': ['0', 1] };
/** A character as [qcode, needsShift]; null when it has no key on a US keyboard. */
function charKey(ch) {
  if (SYM[ch]) return [SYM[ch][0], !!SYM[ch][1]];
  if (/^[a-z0-9]$/.test(ch)) return [ch, false];
  if (/^[A-Z]$/.test(ch)) return [ch.toLowerCase(), true];
  return null;
}
const keyEv = (k, down) => ({ type: 'key', data: { down, key: { type: 'qcode', data: k } } });
/** A key combination (all pressed in order, released in reverse). */
const combo = keys => { const q = keys.map(qcode); return [...q.map(k => keyEv(k, true)), ...q.slice().reverse().map(k => keyEv(k, false))]; };
function typeEvents(text) {
  const ev = [];
  for (const ch of String(text).replace(/\r\n/g, '\n')) {
    const k = charKey(ch); if (!k) continue;
    if (k[1]) ev.push(keyEv('shift', true));
    ev.push(keyEv(k[0], true), keyEv(k[0], false));
    if (k[1]) ev.push(keyEv('shift', false));
  }
  return ev;
}
const absEv = (axis, v) => ({ type: 'abs', data: { axis, value: Math.max(0, Math.min(32767, Math.round(v))) } });
const btnEv = (button, down) => ({ type: 'btn', data: { down, button } });

module.exports = { LOG_DIR, logPath, attr, esc, devices, addDevice, disks, nextTarget, ensureDevices, buildXml, qcode, charKey, combo, typeEvents, keyEv, absEv, btnEv };
