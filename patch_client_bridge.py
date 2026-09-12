import sys

def main():
    with open('public/scripts/comp/agentClientBridge.js', 'r') as f:
        content = f.read()

    new_block = """            if (command === 'run_client_js') {
                try {
                    const func = new Function('return (' + (data.script || '') + ');');
                    const result = func();
                    replyAgentSessionResult(requestId, { ok: true, result });
                } catch (err) {
                    replyAgentSessionResult(requestId, { ok: false, error: err.message });
                }
                return;
            }
            if (command === 'inspect_elements') {
                const results = [];
                try {
                    const selectors = data.selectors || [];
                    const returnHtml = data.html !== false;
                    const returnStyle = data.style !== false;
                    const styleAllowlist = Array.isArray(data.styleAllowlist) ? data.styleAllowlist : null;

                    for (const sel of selectors) {
                        const els = document.querySelectorAll(sel);
                        for (const el of els) {
                            const info = {};
                            if (returnHtml) {
                                info.outerHTML = el.outerHTML;
                            }
                            if (returnStyle) {
                                const computed = window.getComputedStyle(el);
                                const styles = {};
                                if (styleAllowlist) {
                                    for (const prop of styleAllowlist) {
                                        styles[prop] = computed.getPropertyValue(prop);
                                    }
                                } else {
                                    for (let i = 0; i < computed.length; i++) {
                                        const prop = computed[i];
                                        styles[prop] = computed.getPropertyValue(prop);
                                    }
                                }
                                info.computedStyle = styles;
                            }
                            results.push(info);
                            if (results.length >= 50) break; // Cap
                        }
                        if (results.length >= 50) break; // Cap
                    }
                    replyAgentSessionResult(requestId, { ok: true, elements: results });
                } catch (err) {
                    replyAgentSessionResult(requestId, { ok: false, error: err.message });
                }
                return;
            }
            if (command === 'client_update') {"""

    content = content.replace("            if (command === 'client_update') {", new_block)

    with open('public/scripts/comp/agentClientBridge.js', 'w') as f:
        f.write(content)

if __name__ == "__main__":
    main()
