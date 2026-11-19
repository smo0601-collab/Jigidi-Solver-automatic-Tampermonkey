// ==UserScript==
// @name        Jigidi Diagnose
// @namespace   to.soon.userjs.jigidi.diag
// @match       https://www.jigidi.com/solve*
// @match       https://www.jigidi.com/s/*
// @match       https://www.jigidi.com/*/solve*
// @match       https://www.jigidi.com/*/s/*
// @grant       none
// @run-at      document-start
// @version     0.1
// @description Misst, wie Jigidi die Puzzleteile zeichnet (putImageData, drawImage, Worker, OffscreenCanvas, WebGL). Nur zur Fehlersuche, veraendert nichts.
// ==/UserScript==

// Zum Testen den Auto Solver und den Bingo Solver deaktivieren.

(function () {
    'use strict';

    const stats = {
        putImageData: 0, getImageData: 0, createImageData: 0, drawImage: 0,
        ctx2d: 0, ctxWebgl: 0, ctxBitmap: 0, offscreenCreated: 0, transferOffscreen: 0,
        workers: [], scripts: []
    };

    function wrap(proto, name, counter) {
        const orig = proto[name];
        if (typeof orig !== 'function') return;
        proto[name] = function () { stats[counter || name]++; return orig.apply(this, arguments); };
    }

    wrap(CanvasRenderingContext2D.prototype, 'putImageData');
    wrap(CanvasRenderingContext2D.prototype, 'getImageData');
    wrap(CanvasRenderingContext2D.prototype, 'createImageData');
    wrap(CanvasRenderingContext2D.prototype, 'drawImage');

    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
        if (type === '2d') stats.ctx2d++;
        else if (/webgl/.test(type)) stats.ctxWebgl++;
        else if (type === 'bitmaprenderer') stats.ctxBitmap++;
        return origGetContext.apply(this, arguments);
    };

    if (typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function') {
        const o = HTMLCanvasElement.prototype.transferControlToOffscreen;
        HTMLCanvasElement.prototype.transferControlToOffscreen = function () { stats.transferOffscreen++; return o.apply(this, arguments); };
    }
    if (typeof window.OffscreenCanvas === 'function') {
        const O = window.OffscreenCanvas;
        window.OffscreenCanvas = function () { stats.offscreenCreated++; return new O(...arguments); };
        window.OffscreenCanvas.prototype = O.prototype;
    }
    if (typeof window.Worker === 'function') {
        const Wk = window.Worker;
        window.Worker = function (url) { stats.workers.push(String(url).slice(0, 80)); return new Wk(...arguments); };
        window.Worker.prototype = Wk.prototype;
    }

    function report() {
        const canvases = [...document.querySelectorAll('canvas')].map(c => `${c.width}x${c.height}`);
        const frames = document.querySelectorAll('iframe').length;
        stats.scripts = [...document.scripts].map(s => s.src).filter(Boolean).filter(s => /jigidi/.test(s)).map(s => s.slice(0, 90));
        const text = JSON.stringify(Object.assign({ canvasesInDom: canvases, iframes: frames, readyState: document.readyState }, stats), null, 1);
        console.log('[JigidiDiagnose]', text);
        const pre = document.createElement('pre');
        pre.textContent = '[JigidiDiagnose]\n' + text;
        pre.style.cssText = 'position:fixed;left:0;bottom:0;max-width:60vw;max-height:50vh;overflow:auto;margin:0;padding:8px;background:#fff;color:#000;font:11px monospace;z-index:2147483647;border:2px solid red;user-select:all;';
        pre.title = 'Klick = alles markieren, dann Strg+C';
        document.documentElement.appendChild(pre);
    }

    setTimeout(report, 8000);
})();
