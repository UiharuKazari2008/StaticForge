/* Rack Manager harness: a mocked window.wsClient that answers the rack_* packets of docs/rack-manager/README.md.
   rackd data is made up from the README's real host facts (Fat Misaka: 80 threads, 503 GB, VGs misaka-vg / vmdata, br0);
   iLO answers are real, read through the harness server's GET-only proxy of 127.0.0.1:8790. */
(function () {
    'use strict';
    const GB = 1024 ** 3;
    const NOW = Date.now();
    try { localStorage.setItem('userType', 'admin'); } catch (_) { /* none */ }
    const listeners = {};
    const M = { calls: [], subs: [], iloWrites: [], rackdUp: true };
    window.__mock = M;

    const servers = [
        { name: 'misaka', label: 'Fat Misaka', model: 'ProLiant DL580 G7', ilo: { connected: true, power: 'on' }, rackd: { state: 'up' } },
        { name: 'asuka', label: 'Chubby Asuka', model: 'ProLiant DL380 G5', ilo: { connected: true, power: 'on' }, rackd: { state: 'not-deployed' } }
    ];
    const role = (installed, summary, missing) => ({ installed, ready: installed, summary: summary || '', missing: missing || [] });
    const info = {
        host: 'fat-misaka', os: 'Debian GNU/Linux 13 (trixie)', kernel: '6.12.48+deb13-amd64', uptimeS: 9 * 86400 + 4 * 3600,
        cpus: { count: 4, model: 'Intel(R) Xeon(R) CPU E7- 4860 @ 2.27GHz', threads: 80 }, memory: { totalB: 503 * GB, availB: 431 * GB }, load: [2.41, 1.87, 1.2],
        rackd: { version: '0.1.0', startedAt: NOW - 3 * 86400e3 },
        roles: {
            vms: role(true, '1 running, 2 defined'), android: role(true, '1 ready'), sandboxes: role(true, '2 running'), containers: role(false, '', ['docker.io']),
            builds: role(false, '', ['docker.io', 'git']), terminal: role(true, '2 tmux sessions'), storage: role(true, '2 volume groups'), networking: role(true, 'br0 up'),
            services: role(true, '142 loaded'), logs: role(true), updates: role(true, '7 updates')
        }
    };
    const vms = { vms: [
        { name: 'ds-template', uuid: 'a1', state: 'shut off', vcpus: 4, memMB: 8192, autostart: false, persistent: true, disks: [{ target: 'vda', source: '/dev/misaka-vg/ds-template', sizeB: 60 * GB }], nics: [{ mac: '52:54:00:aa:01:01', network: 'br0', ip: '' }], tags: { purpose: 'template', template: 'dreamscape' } },
        { name: 'ds-clone-1118', uuid: 'a2', state: 'running', vcpus: 4, memMB: 8192, autostart: false, persistent: true, disks: [{ target: 'vda', source: '/dev/misaka-vg/ds-clone-1118', sizeB: 60 * GB }], nics: [{ mac: '52:54:00:aa:01:02', network: 'br0', ip: '192.168.100.61' }], tags: { purpose: 'ds-clone', branch: 'main' } },
        { name: 'win7-ie-test', uuid: 'a3', state: 'paused', vcpus: 2, memMB: 4096, autostart: false, persistent: true, disks: [{ target: 'vda', source: '/dev/vmdata/win7', sizeB: 40 * GB }], nics: [{ mac: '52:54:00:aa:01:03', network: 'br0', ip: '192.168.100.62' }], tags: { purpose: 'compat test' } }
    ], networks: [{ name: 'br0' }, { name: 'default' }], pools: [{ name: 'ssd' }, { name: 'hdd' }], templates: [] };
    const android = { sdk: { path: '/opt/android-sdk', emulator: '35.4.9', platformTools: '36.0.0' }, kvm: true,
        avds: [
            { name: 'aemu-fold-2', api: 37, abi: 'x86_64', device: 'pixel_fold', ramMB: 4096, diskB: 6 * GB, running: true, serial: 'emulator-5554', consolePort: 5554, adbPort: 5555, boot: 'ready', pid: 4410, backend: 'sdk-emulator (older build)' },
            { name: 'aemu-a53-4', api: 36, abi: 'x86_64', device: 'pixel_6a', ramMB: 3072, diskB: 5 * GB, running: false, serial: '', boot: 'off', backend: 'sdk-emulator' },
            { name: 'cf-test', api: 36, abi: 'x86_64', device: 'cuttlefish', ramMB: 4096, diskB: 8 * GB, running: true, serial: '0.0.0.0:6520', boot: 'booting', backend: 'cuttlefish' }
        ],
        images: [{ package: 'system-images;android-37;google_apis;x86_64', installed: true }, { package: 'system-images;android-36;google_apis;x86_64', installed: true }, { package: 'system-images;android-35;google_apis_playstore;x86_64', installed: false }], devices: [] };
    const sandboxes = { browser: { path: '/usr/bin/chromium', version: '131.0.6778.204' }, sandboxes: [
        { id: 'sb1', name: 'phone-ui-check', state: 'running', pid: 5120, cdpPort: 9401, profile: '/mnt/ram/sb1', ramdisk: true, url: 'https://dreamscape.example/app.html', viewport: { w: 390, h: 844, dpr: 3, mobile: true } },
        { id: 'sb2', name: 'desktop-regress', state: 'stopped', cdpPort: 9402, ramdisk: false, url: 'about:blank', viewport: { w: 1366, h: 768, dpr: 1, mobile: false } }
    ] };
    const containers = { engine: { version: '26.1.5', dataRoot: '/srv/rack/docker', running: true },
        containers: [{ id: 'c1', name: 'rack-build-dsapp-7', image: 'rack/dsapp-build:1', state: 'running', status: 'Up 12 minutes', ports: [], cpus: 16, memB: 24 * GB, labels: {}, createdAt: NOW - 700e3 }, { id: 'c2', name: 'registry', image: 'registry:2', state: 'exited', status: 'Exited (0) 2 days ago', ports: ['5000->5000/tcp'], createdAt: NOW - 4 * 86400e3 }],
        images: [{ id: 'i1', tags: ['rack/dsapp-build:1'], sizeB: 4.2 * GB, createdAt: NOW - 86400e3 }, { id: 'i2', tags: ['registry:2'], sizeB: 25e6, createdAt: NOW - 90 * 86400e3 }], volumes: [{ name: 'gradle-cache', sizeB: 8 * GB, usedBy: ['rack-build-dsapp-7'] }, { name: 'old-data', sizeB: 1e8, usedBy: [] }], networks: [] };
    const builds = { pipelines: [
        { id: 'dsapp', name: 'DSApp (Android debug)', repo: 'https://yozora.bluesteel.737.jp.net/DreamScape/DSApp-Kotlin.git', ref: 'main', image: 'rack/dsapp-build:1', cpus: 16, memGB: 24, cacheRamdisk: 32, script: './gradlew assembleDebug', artifacts: ['app/build/outputs/apk/debug/*.apk'], lastRun: { state: 'done', startedAt: NOW - 3600e3 } },
        { id: 'alchemy-chromium', name: 'Alchemy-Chromium', repo: 'https://yozora.bluesteel.737.jp.net/DreamScape/Alchemy-Chromium.git', ref: 'main', image: 'rack/chromium-build:1', script: 'autoninja -C out/Release chrome', artifacts: [], lastRun: null },
        { id: 'staticforge-tests', name: 'StaticForge tests', repo: 'https://yozora.bluesteel.737.jp.net/DreamScape/StaticForge.git', ref: 'main', image: 'node:20', script: 'npm ci && npm test', artifacts: [], lastRun: { state: 'failed', startedAt: NOW - 86400e3 } }
    ], runs: [
        { id: 'run-20261127-1', pipeline: 'dsapp', ref: 'main', commit: '3f9a2c1d77e0', state: 'running', startedAt: NOW - 240e3, by: 'claude', artifacts: [] },
        { id: 'run-20261127-0', pipeline: 'dsapp', ref: 'fix/1405', commit: '9be01c44a1d2', state: 'done', startedAt: NOW - 3600e3, endedAt: NOW - 3000e3, exitCode: 0, by: 'claude', artifacts: [{ name: 'app-debug.apk', sizeB: 61e6 }] },
        { id: 'run-20261126-2', pipeline: 'staticforge-tests', ref: 'main', commit: '0aa31ce9ff10', state: 'failed', startedAt: NOW - 86400e3, endedAt: NOW - 86300e3, exitCode: 1, by: 'menma', artifacts: [] }
    ] };
    const storage = {
        disks: [
            { name: 'sda', size: '476.9G', type: 'disk', model: 'Samsung SSD 870', children: [{ name: 'sda1', size: '1G', type: 'part', fstype: 'vfat', mountpoint: '/boot/efi' }, { name: 'sda2', size: '475.9G', type: 'part', fstype: 'LVM2_member', children: [{ name: 'misaka--vg-root', size: '100G', type: 'lvm', fstype: 'ext4', mountpoint: '/' }, { name: 'misaka--vg-docker', size: '3G', type: 'lvm', fstype: 'ext4', mountpoint: '/srv/rack/docker' }] }] },
            { name: 'sdb', size: '4.6T', type: 'disk', model: 'HP LOGICAL VOLUME', children: [{ name: 'sdb1', size: '4.6T', type: 'part', fstype: 'LVM2_member' }] }
        ],
        filesystems: [{ mount: '/', fstype: 'ext4', sizeB: 98 * GB, usedB: 21 * GB, availB: 72 * GB }, { mount: '/boot/efi', fstype: 'vfat', sizeB: 1 * GB, usedB: 0.01 * GB, availB: 0.99 * GB }, { mount: '/mnt/ram/build-cache', fstype: 'tmpfs', sizeB: 64 * GB, usedB: 58 * GB, availB: 6 * GB }],
        arrays: [], ramdisks: [{ name: 'build-cache', kind: 'tmpfs', sizeB: 64 * GB, usedB: 58 * GB, mount: '/mnt/ram/build-cache', owner: 'rack', backing: '/srv/rack/builds/cache', syncMin: 10, persist: true }],
        memory: { totalB: 503 * GB, availB: 431 * GB, ramdiskB: 64 * GB },
        vgs: [{ name: 'misaka-vg', sizeB: 476 * GB, freeB: 373 * GB, pvs: ['/dev/sda2'] }, { name: 'vmdata', sizeB: 4.55 * 1024 * GB, freeB: 4.55 * 1024 * GB - 20 * GB, pvs: ['/dev/sdb1'] }],
        lvs: [{ vg: 'misaka-vg', name: 'root', sizeB: 100 * GB, mount: '/', fstype: 'ext4' }, { vg: 'misaka-vg', name: 'docker', sizeB: 3 * GB, mount: '/srv/rack/docker', fstype: 'ext4' }, { vg: 'misaka-vg', name: 'ds-clone-1118', sizeB: 60 * GB, usedBy: ['ds-clone-1118'] }, { vg: 'vmdata', name: 'scratch', sizeB: 20 * GB, fstype: 'xfs' }]
    };
    const networking = {
        interfaces: [{ name: 'lo', state: 'up', mac: '00:00:00:00:00:00', mtu: 65536, addrs: ['127.0.0.1/8'], rxB: 4e8, txB: 4e8 }, { name: 'eno1', state: 'up', mac: '9c:b6:54:01:02:03', mtu: 1500, addrs: [], speed: 1000, rxB: 8e11, txB: 3e11 }, { name: 'br0', state: 'up', mac: '9c:b6:54:01:02:03', mtu: 1500, addrs: ['192.168.100.42/24'], rxB: 8e11, txB: 3e11 }, { name: 'vnet0', state: 'up', mac: 'fe:54:00:aa:01:02', mtu: 1500, addrs: [], rxB: 1e9, txB: 1e9 }],
        routes: [{ dst: 'default', gateway: '192.168.100.1', dev: 'br0', metric: 100 }, { dst: '192.168.100.0/24', dev: 'br0', prefsrc: '192.168.100.42' }],
        bridges: [{ name: 'br0', ports: ['eno1', 'vnet0'], state: 'up' }, { name: 'virbr0', ports: [], state: 'down' }],
        listening: [{ proto: 'tcp', addr: '0.0.0.0', port: 22, process: 'sshd' }, { proto: 'tcp', addr: '127.0.0.1', port: 8791, process: 'node (rackd)' }, { proto: 'tcp', addr: '127.0.0.1', port: 9401, process: 'chromium' }],
        libvirt: [{ name: 'br0', active: true, bridge: 'br0', subnet: '192.168.100.0/24' }, { name: 'default', active: false, bridge: 'virbr0', subnet: '192.168.122.0/24' }]
    };
    const svcs = ['ssh.service:OpenBSD Secure Shell server:active:running:enabled', 'libvirtd.service:libvirt legacy monolithic daemon:active:running:enabled', 'rackd.service:Rack host agent:active:running:enabled', 'rack-build-watch.service:Rack build watcher:active:running:enabled', 'cron.service:Regular background program processing daemon:active:running:enabled', 'smartmontools.service:Self Monitoring and Reporting Technology daemon:active:running:enabled', 'docker.service:Docker Application Container Engine:inactive:dead:disabled', 'apt-daily.service:Daily apt download activities:inactive:dead:static', 'hpwdt-guard.service:Keep the watchdog quiet:failed:failed:enabled', 'systemd-journald.service:Journal Service:active:running:static', 'systemd-networkd.service:Network Configuration:active:running:enabled', 'tmux-keeper.service:tmux sessions:active:exited:enabled'];
    const services = { services: svcs.map((s) => { const [unit, description, active, sub, enabled] = s.split(':'); return { unit, load: 'loaded', active, sub, description, enabled }; }), rack: [{ name: 'build-watch', unit: 'rack-build-watch.service', cmd: '/opt/rackd/bin/watch.sh', user: 'rack', cwd: '/srv/rack' }] };
    const updates = { lastCheck: NOW - 6 * 3600e3, rebootRequired: true, upgradable: [{ package: 'linux-image-amd64', from: '6.12.48-1', to: '6.12.57-1', security: true }, { package: 'openssl', from: '3.5.1-1', to: '3.5.4-1', security: true }, { package: 'libvirt-daemon', from: '11.3.0-2', to: '11.3.0-3', security: false }, { package: 'tmux', from: '3.5a-3', to: '3.5a-4', security: false }, { package: 'curl', from: '8.14.1-2', to: '8.14.1-3', security: true }, { package: 'qemu-system-x86', from: '10.0.2-1', to: '10.0.3-1', security: false }, { package: 'nodejs', from: '20.19.2', to: '20.19.5', security: false }], held: ['docker.io'], history: [{ start: NOW - 8 * 86400e3, end: NOW - 8 * 86400e3 + 60e3, command: 'apt-get -y upgrade', upgraded: ['bash', 'libc6', 'systemd'] }] };
    const terminal = { tmux: [{ name: 'build-dsapp', created: NOW - 7200e3, attached: false, windows: 2, cmd: './gradlew assembleDebug' }, { name: 'ops', created: NOW - 86400e3, attached: true, windows: 1, cmd: 'bash' }], ptys: [] };
    const jobs = [{ id: 'j-1', role: 'updates', title: 'apt-get update', state: 'done', startedAt: NOW - 6 * 3600e3, endedAt: NOW - 6 * 3600e3 + 12e3, exitCode: 0, log: 'Hit:1 http://deb.debian.org/debian trixie InRelease\nReading package lists... Done' }, { id: 'run-20261127-1', role: 'builds', title: 'Build dsapp main', state: 'running', startedAt: NOW - 240e3, log: '> Task :app:compileDebugKotlin\n> Task :app:mergeDebugResources' }];
    const logsFor = (q) => {
        const units = ['rackd.service', 'libvirtd.service', 'sshd', 'kernel', 'systemd'];
        const msg = ['rackd: GET /v1/vms 200 12ms', 'Accepted publickey for hvadmin from 192.168.100.250', 'Started Session 412 of User hvadmin.', 'hpwdt: watchdog disabled', 'qemu-kvm: warning: host doesn\'t support requested feature: CPUID.07H:EBX.avx2', 'libvirt: error : internal error: process exited while connecting to monitor'];
        const n = Math.min(Number(q && q.lines) || 200, 60);
        const entries = Array.from({ length: n }, (_, i) => ({ t: new Date(NOW - (n - i) * 61e3).toISOString(), unit: units[i % units.length], priority: i % 17 === 0 ? 3 : i % 7 === 0 ? 4 : 6, pid: 1000 + i, message: msg[i % msg.length] })).filter((e) => !(q && q.unit) || e.unit.includes(q.unit)).filter((e) => !(q && q.grep) || e.message.includes(q.grep));
        return { entries, boots: [{ id: 0, first: NOW - 9 * 86400e3, last: NOW }] };
    };
    const RANGE_MS = { '3h': 3 * 3600e3, '6h': 6 * 3600e3, '24h': 86400e3, '7d': 7 * 86400e3 };
    const metricsFor = (q) => {
        const span = RANGE_MS[(q && q.range) || '3h'] || 3 * 3600e3;
        const n = Math.min(Number(q && q.points) || 360, 360);
        const to = Date.now();
        const from = to - span;
        const step = Math.round(span / n);
        const samples = Array.from({ length: n }, (_, i) => {
            const f = i / n;
            const busy = f > 0.55 && f < 0.8;
            const t = from + i * step;
            return { t, cpu: Math.round(8 + 6 * Math.sin(i / 9) + (busy ? 55 + 15 * Math.sin(i / 3) : 0)), memUsedB: (70 + (busy ? 40 : 0) + 4 * Math.sin(i / 20)) * GB, memTotalB: 503 * GB,
                diskRBps: (busy ? 90e6 : 2e6) * (1 + Math.sin(i / 4) * 0.5), diskWBps: (busy ? 160e6 : 4e6) * (1 + Math.cos(i / 5) * 0.5), netRxBps: (busy ? 30e6 : 0.4e6) * (1 + Math.sin(i / 6) * 0.4), netTxBps: (busy ? 5e6 : 0.2e6), load1: busy ? 14 : 1.2,
                vms: f < 0.3 ? 1 : 2, avds: f > 0.45 ? 1 : 0, sandboxes: 2, containers: busy ? 1 : 0, replicas: f > 0.85 ? 1 : 0, builds: busy ? 1 : 0, jobs: f > 0.9 ? 1 : 0 };
        });
        return { from, to, step, samples };
    };
    M.pushMetrics = () => emit('rack_event', { server: 'misaka', role: 'host', kind: 'metrics', data: { cpu: 91, mem: { totalB: 503 * GB, usedB: 120 * GB }, load: [15, 12, 9], net: { rxBps: 41e6, txBps: 6e6 }, disk: { rBps: 120e6, wBps: 210e6 } } });
    const roleData = { vms, android, sandboxes, containers, builds, storage, networking, services, updates, terminal, jobs: { jobs } };

    const ok = (s) => new Promise((r) => setTimeout(() => r(s), 15));
    const iloGet = async (server, path) => {
        if (server !== 'misaka') throw new Error('The iLO of Chubby Asuka is not connected.');
        const r = await fetch(`/__ilo/${path}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.status);
        return j;
    };
    const emit = (type, msg) => (listeners[type] || []).forEach((f) => f(msg));
    M.emit = emit;
    M.pushJob = (server, job) => emit('rack_event', { server, role: job.role, kind: 'job', id: job.id, data: job });
    const startJob = (server, role, title, ms = 900) => {
        const job = { id: `j-${Math.random().toString(36).slice(2, 7)}`, role, title, state: 'running', startedAt: Date.now(), log: 'Starting...' };
        jobs.unshift(job);
        setTimeout(() => M.pushJob(server, Object.assign({}, job, { log: `${title}\nWorking...` })), 200);
        setTimeout(() => { job.state = 'done'; job.endedAt = Date.now(); job.exitCode = 0; job.log = `${title}\nDone.`; M.pushJob(server, Object.assign({}, job)); }, ms);
        return job;
    };

    const handlers = {
        rack_list: async () => ({ servers }),
        rack_get: async ({ server, role: r, query }) => {
            if (server !== 'misaka') throw new Error('rackd is not deployed on this server');
            if (r === 'info') return { role: 'info', data: info };
            if (r === 'logs') return { role: 'logs', data: logsFor(query) };
            if (r === 'metrics') return { role: 'metrics', data: metricsFor(query) };
            if (!roleData[r]) throw new Error(`unknown role ${r}`);
            return { role: r, data: roleData[r] };
        },
        rack_action: async ({ server, role: r, action, params }) => {
            M.calls.push({ server, role: r, action, params });
            if (action === 'screenshot') return { result: { file: `${r}-${Date.now()}.png` } };
            if (r === 'roles' && action === 'install') return { job: startJob(server, params.role, `Install role ${params.role}`, 1400) };
            if (['create', 'clone', 'dsclone', 'pull', 'build', 'check', 'upgrade', 'install', 'sdk', 'run', 'autoremove', 'prune'].includes(action) && !(r === 'containers' && action === 'run')) return { job: startJob(server, r, `${r} ${action}`) };
            if (action === 'snapshots') return { result: { snapshots: [{ name: 'before-upgrade', created: NOW - 86400e3 }] } };
            if (action === 'shell' || action === 'exec') return { result: { code: 0, out: `ran: ${params.cmd}\n` } };
            if (action === 'cdp') return { result: { port: 9401, wsPath: '/devtools/browser/abc' } };
            if (action === 'ping') return { result: { out: `PING ${params.host}: 56 data bytes\n64 bytes from ${params.host}: icmp_seq=0 ttl=64 time=0.3 ms\n` } };
            if (action === 'status') return { result: { props: { ActiveState: 'active', SubState: 'running', MainPID: '842', MemoryCurrent: '41 MB' }, log: ['Nov 27 22:01:12 fat-misaka rackd[842]: listening on 127.0.0.1:8791'] } };
            if (action === 'logs') return { result: { text: 'line one\nline two\n' } };
            if (action === 'follow') { setTimeout(() => emit('rack_event', { server, role: 'logs', kind: 'log', data: { t: new Date().toISOString(), unit: 'sshd', priority: 6, message: 'live line from the follow' } }), 300); return { result: { followId: 'f1' } }; }
            if (action === 'dmesg') return { result: { text: '[    0.000000] Linux version 6.12.48\n[    1.2] hpwdt: ...\n' } };
            if (action === 'run-get') return { result: { id: params.run, log: 'Cloning...\n> Task :app:assembleDebug\nBUILD SUCCESSFUL in 4m 11s\n' } };
            return { result: { ok: true } };
        },
        rack_ilo: async ({ server, what, params }) => {
            const q = params || {};
            if (what === 'health') return { data: await iloGet(server, `${server}/health${q.fresh ? '?fresh' : ''}`) };
            if (what === 'power') return { data: await iloGet(server, `${server}/power`) };
            if (what === 'history') {
                const want = q.range || '24h';
                if (want !== '3h') return { data: await iloGet(server, `${server}/history?range=${want}`) };
                const hh = await iloGet(server, `${server}/history?range=6h`);
                const cut = hh.to - 3 * 3600e3;
                const cutP = (pts) => pts.filter((p) => p[0] >= cut);
                const out = Object.assign({}, hh, { from: cut, power: cutP(hh.power), temp: {}, fan: {}, on: M.shadeOff ? [[cut, 1], [hh.to - 110 * 60e3, 0], [hh.to - 70 * 60e3, 1]] : cutP(hh.on || []) });
                Object.keys(hh.temp || {}).forEach((k) => { out.temp[k] = cutP(hh.temp[k]); });
                Object.keys(hh.fan || {}).forEach((k) => { out.fan[k] = cutP(hh.fan[k]); });
                return { data: out };
            }
            if (what === 'logs') return { data: await iloGet(server, `${server}/logs?which=${q.which || 'server'}`) };
            if (what === 'memory') return { data: await iloGet(server, `${server}/memory`) };
            if (what === 'servers') return { data: await iloGet(server, 'servers') };
            if (what === 'users') return { data: await iloGet(server, `${server}/ilo/users`) };
            if (what === 'settings') return { data: await iloGet(server, `${server}/ilo/settings`) };
            if (what === 'media') return { data: await iloGet(server, `${server}/vm`) };
            if (what === 'isos') return { data: [{ name: 'debian-13.1-amd64-netinst.iso', size: 754974720 }, { name: 'SLE-Micro.iso', size: 1.4e9 }] };
            throw new Error(`unknown ilo ${what}`);
        },
        rack_ilo_action: async ({ server, action, params }) => { M.iloWrites.push({ server, action, params }); if (action === 'powercap') return { result: { present: 575, average: 550, min: 539, max: 841, cap: params.watts, regulator: 'MAX', t: Date.now() } }; if (action === 'media') return { result: { options: [{ device: 'CDROM', vm_url_connected: !params.action, vm_url: params.iso || params.url }] } }; return { result: { ok: true } }; },
        rack_power: async ({ server, action }) => {
            if (action === 'status') return { state: M.powerState, since: NOW - 3600e3, leases: M.leases(), idle: { idle: false, idleSince: 0, busy: [{ kind: 'build', id: 'run-20261127-1', why: 'running' }, { kind: 'vm', id: 'ds-clone-1118', why: 'running' }] }, deadline: 0, settings: M.settings };
            if (action === 'on') { M.setPower('powering-on'); return { state: 'powering-on' }; }
            if (action === 'off') { M.setPower('shutting-down'); setTimeout(() => M.setPower('off'), 600); return { state: 'shutting-down' }; }
            return {};
        },
        rack_power_settings: async ({ settings }) => { M.settings = Object.assign({}, M.settings, settings); M.iloWrites.push({ settings }); return { settings: M.settings }; },
        rack_subscribe: async ({ server }) => { M.subs.push(`+${server}`); return {}; },
        rack_unsubscribe: async ({ server }) => { M.subs.push(`-${server}`); return {}; },
        rack_job: async ({ server, id, cancel }) => { const j = jobs.find((x) => x.id === id); if (cancel && j) { j.state = 'cancelled'; } return { job: j || { id } }; }
    };
    M.powerState = 'up';
    M.settings = { auto: true, idleShutdownMin: 180, wakeOnDemand: true };
    M.leases = () => [{ id: 'l1', purpose: 'console: Rack Manager', who: 'Yukimi', since: NOW - 600e3, ends: NOW + 3000e3 }, { id: 'l2', purpose: 'build run-20261127-1 (dsapp)', who: 'claude', since: NOW - 240e3, ends: NOW + 3500e3 }];
    M.setPower = (state, post) => { M.powerState = state; emit('rack_event', { server: 'misaka', role: 'power', kind: 'state', data: { state, since: Date.now(), post: post || (state === 'powering-on' ? { stage: 'Option ROMs (SATA, QLogic gPXE, iLO, Smart Array)', pct: 58, eta: 70, code: '5808' } : undefined) } }); };
    M.info = info; M.roleData = roleData; M.servers = servers;
    window.wsClient = {
        on: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        off: () => {},
        sendMessage: async (type, data) => { const h = handlers[type]; if (!h) throw new Error(`The server did not understand ${type}.`); return ok(await h(data || {})); }
    };
})();
