// ==UserScript==
// @name        Jigidi Diagnose 2
// @namespace   to.soon.userjs.jigidi.diag2
// @match       https://www.jigidi.com/solve*
// @match       https://www.jigidi.com/s/*
// @match       https://www.jigidi.com/*/solve*
// @match       https://www.jigidi.com/*/s/*
// @grant       none
// @run-at      document-start
// @version     0.1
// @description Protokolliert die einzelnen putImageData- und drawImage-Aufrufe von Jigidi. Nur zur Fehlersuche, veraendert nichts.
// ==/UserScript==

// Zum Testen alle anderen Jigidi-Scripts deaktivieren.

(function () {
    'use strict';

    const lines = [];
    const tag = new WeakMap();   // Canvas -> Nummer des putImageData-Aufrufs
    let putN = 0, drawMain = 0, drawOther = 0;
    const MAXD = 70;

    const P = CanvasRenderingContext2D.prototype;
    const oPut = P.putImageData, oDraw = P.drawImage, oGet = P.getImageData;

    P.putImageData = function (img, dx, dy) {
        const c = this.canvas;
        if (c && !tag.has(c)) tag.set(c, putN);
        lines.push(`put#${putN} img=${img.width}x${img.height} at=${dx},${dy} canvas=${c && c.width}x${c && c.height} inDom=${!!(c && c.isConnected)}`);
        putN++;
        return oPut.apply(this, arguments);
    };

    P.getImageData = function (x, y, w, h) {
        lines.push(`get ${x},${y} ${w}x${h} canvas=${this.canvas && this.canvas.width}x${this.canvas && this.canvas.height} inDom=${!!(this.canvas && this.canvas.isConnected)}`);
        return oGet.apply(this, arguments);
    };

    P.drawImage = function (src) {
        const c = this.canvas;
        if (c && c.isConnected) {
            drawMain++;
            if (drawMain <= MAXD) {
                const t = (src && tag.has(src)) ? 'put#' + tag.get(src) : 'ohne-put-tag';
                const a = [...arguments].slice(1).map(v => typeof v === 'number' ? Math.round(v) : '?').join(',');
                lines.push(`drawMain#${drawMain} src=${src && src.constructor && src.constructor.name} ${src && src.width}x${src && src.height} tag=${t} args=${a}`);
            }
        } else {
            drawOther++;
        }
        return oDraw.apply(this, arguments);
    };

    function report() {
        const head = `puts=${putN} drawMain=${drawMain} drawOther=${drawOther} lines=${lines.length}`;
        const text = head + '\n' + lines.slice(0, 160).join('\n');
        console.log('[JigidiDiagnose2]', text);
        const pre = document.createElement('pre');
        pre.textContent = '[JigidiDiagnose2]\n' + text;
        pre.style.cssText = 'position:fixed;left:0;top:0;max-width:70vw;max-height:90vh;overflow:auto;margin:0;padding:8px;background:#fff;color:#000;font:11px monospace;z-index:2147483647;border:2px solid red;user-select:all;';
        pre.title = 'Klick = alles markieren, dann Strg+C';
        document.documentElement.appendChild(pre);
    }

    setTimeout(report, 8000);
})();
