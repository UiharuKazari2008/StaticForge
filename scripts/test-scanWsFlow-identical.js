const { buildWsLinks } = require('../modules/flowMap/scanWsFlow');

function getOriginalBuildWsLinks() {
    return function buildWsLinksOrig(serverHandlers, clientInbound, clientOutbound, serverOutbound) {
        function resolveHandlerImplFile(a, b) { return null; }
        const links = [];

        for (const handler of serverHandlers) {
            const implRel = handler.handlerFn
                ? resolveHandlerImplFile(handler.handlerFn, handler.file)
                : null;

            const responses = serverOutbound.filter((o) => {
                if (!implRel) return o.file === handler.file;
                return o.file === implRel || o.file === handler.file;
            });

            const responseTypes = [...new Set(responses.map((r) => r.type))];
            const inbounds = clientInbound.filter((c) => responseTypes.includes(c.type));

            const callers = clientOutbound.filter((c) => c.type === handler.type);

            links.push({
                requestType: handler.type,
                owner: handler.owner,
                server: {
                    registration: handler,
                    implFile: implRel,
                    responses: responses
                },
                client: {
                    callers,
                    inbounds
                },
                responseTypes
            });
        }

        // Orphan inbound (server push / no registered handler in scan)
        for (const inbound of clientInbound) {
            if (links.some((l) => l.responseTypes.includes(inbound.type))) continue;
            links.push({
                requestType: null,
                responseType: inbound.type,
                owner: 'orphan-inbound',
                server: { responses: serverOutbound.filter((o) => o.type === inbound.type) },
                client: { inbounds: [inbound], callers: [] },
                responseTypes: [inbound.type]
            });
        }

        return links;
    }
}

const n = 1000;
const serverHandlers = Array.from({length: n}, (_, i) => ({ type: `type_${i}`, file: 'foo.js', owner: 'test' }));
const serverOutbound = Array.from({length: n}, (_, i) => ({ type: `res_${i}`, file: 'foo.js' }));
const clientInbound = Array.from({length: n}, (_, i) => ({ type: `res_${i % 10}` })); // include duplicates for orphan check
const clientOutbound = Array.from({length: n}, (_, i) => ({ type: `type_${i}` }));

console.time('buildWsLinks_old');
const origRes = getOriginalBuildWsLinks()(serverHandlers, clientInbound, clientOutbound, serverOutbound);
console.timeEnd('buildWsLinks_old');

console.time('buildWsLinks_new');
const newRes = buildWsLinks(serverHandlers, clientInbound, clientOutbound, serverOutbound);
console.timeEnd('buildWsLinks_new');

if (JSON.stringify(origRes) !== JSON.stringify(newRes)) {
    console.error("Mismatch!");
    process.exit(1);
}
console.log("Success! Output is identical.");
