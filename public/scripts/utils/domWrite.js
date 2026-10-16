/**
 * DOM writes that do nothing when nothing changes.
 *
 * Every server ping (and other periodic status updates) re-applies the same values: the gen
 * count, usage, balances, tray titles and classes. `el.textContent = same` still swaps the text
 * node, which costs a style pass over the subtree (the full page before the :has() work, #510),
 * and identical className / classList / attribute writes still queue mutation records that wake
 * every MutationObserver. A ping on 2026-10-16 made 52 such writes, all no-ops, and was followed
 * by a 238 ms style recalc on Yukimi's client. These helpers write only real changes, and a lone
 * text node is updated in place (`.data`), which Chrome does not treat as a node insertion.
 */

/** Set an element's text; a single text child is edited in place. */
function setTextIfChanged(el, text) {
    if (!el) return;
    const value = String(text == null ? '' : text);
    const node = el.firstChild;
    if (node && node.nodeType === 3 && !node.nextSibling) {
        if (node.data !== value) node.data = value;
        return;
    }
    if (el.textContent !== value) el.textContent = value;
}

/** Set el.className only when the string differs. */
function setClassNameIfChanged(el, value) {
    if (el && el.className !== value) el.className = value;
}

/** Add (on) or remove (!on) one class only when that changes it. */
function setClassIfChanged(el, className, on) {
    if (el && el.classList.contains(className) !== !!on) el.classList.toggle(className, !!on);
}

/** Set an attribute only when its value differs. */
function setAttrIfChanged(el, name, value) {
    if (!el) return;
    const next = String(value);
    if (el.getAttribute(name) !== next) el.setAttribute(name, next);
}

/** Set one inline style property only when it differs. */
function setStyleIfChanged(el, prop, value) {
    if (el && el.style[prop] !== value) el.style[prop] = value;
}
