// ==UserScript==
// @name        Jigidi Diagnose 3
// @namespace   to.soon.userjs.jigidi.diag3
// @match       https://www.jigidi.com/solve*
// @match       https://www.jigidi.com/s/*
// @match       https://www.jigidi.com/*/solve*
// @match       https://www.jigidi.com/*/s/*
// @grant       none
// @run-at      document-start
// @version     0.1
// @description Protokolliert, auf welchen Elementen Jigidi Maus-/Pointer-/Touch-Handler anmeldet und ob echte Eingaben als trusted ankommen. Nur zur Fehlersuche.
// ==/UserScript==

// Zum Testen alle anderen Jigidi-Scripts deaktivieren.

(function () {
    'use strict';

    const WANT = /^(mouse|pointer|touch|click|dblclick|contextmenu|wheel|drag)/;
    const regs = [];
    const seen = {};
    const evs = [];

    function desc(t) {
        if (t === window) return 'window';
        if (t === document) return 'document';
        if (!t || !t.tagName) return String(t);
        return t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\s+/).join('.') : '');
    }

    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
        if (WANT.test(type)) {
            const key = desc(this) + '|' + type;
            if (!seen[key]) {
                seen[key] = 1;
                regs.push(`${desc(this)}  ${type}  passive=${opts && typeof opts === 'object' ? !!opts.passive : '-'} capture=${opts === true || !!(opts && opts.capture)}`);
            }
        }
        return orig.apply(this, arguments);
    };

    // Echte Eingaben protokollieren: isTrusted + Ziel (nur Start und Ende eines Zugs)
    let moves = 0;
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousemove', 'pointermove'].forEach(t => {
        orig.call(window, t, e => {
            if (/move/.test(t)) { moves++; if (moves % 25 !== 1) return; }
            if (evs.length < 40) evs.push(`${t} trusted=${e.isTrusted} target=${desc(e.target)} client=${Math.round(e.clientX || 0)},${Math.round(e.clientY || 0)}`);
        }, true);
    });

    function report() {
        const cv = [...document.querySelectorAll('canvas')].map(c => {
            const r = c.getBoundingClientRect();
            return `${desc(c)} intern=${c.width}x${c.height} auf Seite=${Math.round(r.width)}x${Math.round(r.height)} bei ${Math.round(r.left)},${Math.round(r.top)}`;
        });
        const text = 'CANVAS:\n' + cv.join('\n') +
            '\n\nHANDLER (' + regs.length + '):\n' + regs.join('\n') +
            '\n\nECHTE EINGABEN (zieh in den naechsten 25 s ein Teil von Hand):\n' + (evs.length ? evs.join('\n') : '(noch keine)');
        console.log('[JigidiDiagnose3]\n' + text);
        let pre = document.getElementById('jd3');
        if (!pre) {
            pre = document.createElement('pre');
            pre.id = 'jd3';
            pre.style.cssText = 'position:fixed;left:0;top:0;max-width:70vw;max-height:90vh;overflow:auto;margin:0;padding:8px;background:#fff;color:#000;font:11px monospace;z-index:2147483647;border:2px solid red;user-select:all;';
            pre.title = 'Klick = alles markieren, dann Strg+C';
            document.documentElement.appendChild(pre);
        }
        pre.textContent = '[JigidiDiagnose3]\n' + text;
    }

    setTimeout(report, 8000);
    setTimeout(report, 33000);
})();
