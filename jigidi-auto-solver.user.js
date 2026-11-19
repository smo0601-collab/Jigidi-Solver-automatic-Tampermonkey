// ==UserScript==
// @name        Jigidi Auto Solver (experimentell)
// @namespace   to.soon.userjs.jigidi.auto
// @match       https://www.jigidi.com/solve*
// @match       https://www.jigidi.com/s/*
// @match       https://www.jigidi.com/*/solve*
// @match       https://www.jigidi.com/*/s/*
// @grant       none
// @run-at      document-start
// @version     1.5
// @description Liest Position, Massstab und Groesse der Teile direkt aus Jigidis drawImage-Aufrufen und zieht die Teile per simulierten Mausevents an die richtige Position.
// @license     MIT
// @homepageURL https://github.com/smo0601-collab/Jigidi-Solver-automatic-Tampermonkey
// @downloadURL https://raw.githubusercontent.com/smo0601-collab/Jigidi-Solver-automatic-Tampermonkey/main/jigidi-auto-solver.user.js
// @updateURL   https://raw.githubusercontent.com/smo0601-collab/Jigidi-Solver-automatic-Tampermonkey/main/jigidi-auto-solver.user.js
// ==/UserScript==

// WICHTIG: Den originalen "Jigidi Bingo Solver" und die Diagnose-Scripts fuer diese Seite deaktivieren.
// Dieses Script laeuft mit @grant none direkt im Seitenkontext (noetig fuer Firefox),
// Einstellungen liegen deshalb in localStorage.

(function () {
    'use strict';

    const VERSION = '1.5';
    // Tempo-Profile, Wartezeiten in BILDERN (Frames) statt Millisekunden.
    // HOVER = Bilder ueber dem Teil vor dem Klick, DOWN = Bilder nach dem Klick, STEPS = Zwischenschritte beim Ziehen,
    // HOLD = Bilder am Ziel halten, SETTLE = maximale Bilder Wartezeit nach dem Loslassen (nur mit VERIFY).
    // VERIFY = true: nach JEDEM Teil warten und die Position pruefen (sicher, aber langsam: Jigidi laesst die Teile
    //          nach dem Loslassen ca. 0,65 s einrasten). false: sofort mit dem naechsten Teil weitermachen und
    //          erst am Ende jeder Runde pruefen. Teile, die danebenliegen, werden in der naechsten Runde neu gezogen.
    const PRESETS = {
        normal:  { HOVER: 2, DOWN: 2, STEPS: 8, HOLD: 4, SETTLE: 12, VERIFY: true },
        schnell: { HOVER: 1, DOWN: 1, STEPS: 4, HOLD: 2, SETTLE: 8,  VERIFY: false },
        maximal: { HOVER: 1, DOWN: 1, STEPS: 2, HOLD: 1, SETTLE: 6,  VERIFY: false }
    };
    const CFG = {
        ROUNDS: 3,
        TRIES: 3,         // Versuche pro Teil und Runde
        TOL: 0.2,         // erlaubter Abstand zum Ziel in Teilebreiten
        SPEED: 'schnell'
    };

    const log = (...a) => console.log('[AutoSolver]', ...a);
    // Stop: jede Wartezeit prueft das Flag und bricht per Exception ab (Button "Stop" oder Esc-Taste)
    let stopRequested = false;
    let held = null; // gerade gehaltenes Teil {cv, x, y}, wird beim Stoppen losgelassen
    // Frame-Messung: wie lange dauert ein Bild auf dieser Seite? (steht im Protokoll)
    const perf = { frames: 0, ms: 0 };
    const frame = () => new Promise((resolve, reject) => {
        const t = performance.now();
        let done = false;
        const fin = () => {
            if (done) return;
            done = true;
            perf.frames++; perf.ms += performance.now() - t;
            stopRequested ? reject(new Error('STOP')) : resolve();
        };
        requestAnimationFrame(fin);
        setTimeout(fin, 150); // Rueckfall, falls der Tab im Hintergrund keine Bilder zeichnet
    });
    const frames = async n => { for (let i = 0; i < n; i++) await frame(); };
    const sleep = ms => new Promise((resolve, reject) => setTimeout(() => stopRequested ? reject(new Error('STOP')) : resolve(), ms));

    // Protokoll: Zeitstempel (Sekunden seit Scriptstart), Panel-Anzeige, Konsole und Datei-Download
    const T0 = Date.now();
    const logLines = [];
    let traceFn = () => {};
    const trace = t => {
        const line = `[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s] ${t}`;
        logLines.push(line);
        console.log('[AutoSolver]', line);
        traceFn(line);
    };

    const store = {
        get(k, d) { try { const v = localStorage.getItem('jas_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem('jas_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
    };

    CFG.SPEED = store.get('speed', 'schnell');
    if (!PRESETS[CFG.SPEED]) CFG.SPEED = 'schnell';
    Object.assign(CFG, PRESETS[CFG.SPEED]);

    // ---------- Aufzeichnung (Hook, so frueh wie moeglich, nur im Auto-Modus) ----------
    // sizes: Groesse jedes putImageData-Aufrufs, Index = Teil-Nummer in Loesungsreihenfolge
    // pieces: letzte gezeichnete Position (Zellmitte), Massstab und Zeichenreihenfolge pro Teil
    // putOn: Zwischenpuffer-Canvas -> Nummer seines letzten putImageData; tag: Teil-Canvas -> Teil-Nummer
    const rec = { sizes: [], ids: new Map(), idsLen: -1, dupes: [], pieces: new Map(), seq: 0, minOff: Infinity, putOn: new WeakMap(), tag: new WeakMap(), tagged: 0 };
    const state = { active: store.get('run', false) };

    function buildIds() {
        rec.ids = new Map();
        rec.dupes = [];
        rec.sizes.forEach(([w, h], i) => {
            const k = w + 'x' + h;
            if (rec.ids.has(k)) { rec.ids.set(k, -1); rec.dupes.push(k); } else rec.ids.set(k, i);
        });
        rec.idsLen = rec.sizes.length;
    }

    if (state.active) {
        store.set('run', false); // nie in eine Reload-Schleife geraten
        const proto = CanvasRenderingContext2D.prototype;
        const oPut = proto.putImageData;
        const oDraw = proto.drawImage;

        proto.putImageData = function (img) {
            try {
                const pid = rec.sizes.length;
                rec.sizes.push([img.width, img.height]);
                if (this.canvas) rec.putOn.set(this.canvas, pid);
            } catch (e) { /* ignore */ }
            return oPut.apply(this, arguments);
        };

        proto.drawImage = function (src) {
            try {
                const cv = this.canvas;
                // Kopiert Jigidi den Zwischenpuffer in ein eigenes (nicht sichtbares) Teil-Canvas? Dann merken wir uns dessen Teil-Nummer.
                if (cv && src && !cv.isConnected && rec.putOn.has(src)) {
                    const pid = rec.putOn.get(src), sz = rec.sizes[pid];
                    if (sz && cv.width === sz[0] && cv.height === sz[1] && !rec.tag.has(cv)) { rec.tag.set(cv, pid); rec.tagged++; }
                }
                if (cv && cv.isConnected && src && rec.sizes.length) {
                    if (rec.idsLen !== rec.sizes.length) buildIds();
                    let id = rec.tag.get(src);
                    if (id === undefined) id = rec.ids.get(src.width + 'x' + src.height);
                    if (id !== undefined && id >= 0) {
                        const a = arguments;
                        const dx = a.length >= 9 ? a[5] : a[1];
                        const dy = a.length >= 9 ? a[6] : a[2];
                        const m = this.getTransform();
                        rec.pieces.set(id, { x: m.e, y: m.f, s: m.a, t: rec.seq++ });
                        if (typeof dx === 'number' && Math.abs(dx) > 5) rec.minOff = Math.min(rec.minOff, Math.abs(dx));
                        if (typeof dy === 'number' && Math.abs(dy) > 5) rec.minOff = Math.min(rec.minOff, Math.abs(dy));
                    }
                }
            } catch (e) { /* ignore */ }
            return oDraw.apply(this, arguments);
        };
        log('Hook installiert (Auto-Modus).');
    }

    // ---------- Maus simulieren ----------
    function fire(cv, type, x, y, buttons) {
        const r = cv.getBoundingClientRect();
        const cx = r.left + x * r.width / cv.width;
        const cy = r.top + y * r.height / cv.height;
        cv.dispatchEvent(new MouseEvent('mouse' + type, {
            bubbles: true, cancelable: true, view: window,
            clientX: cx, clientY: cy, screenX: cx, screenY: cy,
            button: 0, buttons
        }));
    }

    async function drag(cv, from, to) {
        // Wie ein Mensch: erst ueber das Teil fahren (Jigidi bestimmt das Teil im mousemove), dann klicken
        fire(cv, 'move', from.x - 30, from.y - 20, 0);
        fire(cv, 'move', from.x - 10, from.y - 6, 0);
        fire(cv, 'move', from.x, from.y, 0);
        await frames(CFG.HOVER);
        fire(cv, 'down', from.x, from.y, 1);
        held = { cv, x: from.x, y: from.y };
        await frames(CFG.DOWN);
        fire(cv, 'move', from.x + 3, from.y + 2, 1);
        await frame();
        for (let s = 1; s <= CFG.STEPS; s++) {
            const t = s / CFG.STEPS;
            const mx = from.x + (to.x - from.x) * t, my = from.y + (to.y - from.y) * t;
            fire(cv, 'move', mx, my, 1);
            held.x = mx; held.y = my;
            await frame();
        }
        // Am Ziel kurz halten, damit das Teil dem Zeiger folgen kann
        for (let k = 0; k < CFG.HOLD; k++) {
            fire(cv, 'move', to.x, to.y, 1);
            await frame();
        }
        fire(cv, 'up', to.x, to.y, 0);
        held = null;
    }

    // Wartet, bis das Teil nach jetzt neu gezeichnet wurde, und liefert seine aktuelle Position
    async function fresh(id) {
        const t0 = rec.seq;
        for (let i = 0; i < 40; i++) {
            const p = rec.pieces.get(id);
            if (p && p.t >= t0) return p;
            await frame();
        }
        return rec.pieces.get(id);
    }

    // Nach dem Loslassen: hoechstens SETTLE Bilder warten, aber sofort weiter, sobald das Teil am Ziel ist
    async function settle(id, tx, ty, pitch) {
        let q = await fresh(id);
        for (let i = 1; i < CFG.SETTLE; i++) {
            if (q && Math.hypot(q.x - tx, q.y - ty) < CFG.TOL * pitch) break;
            q = await fresh(id);
        }
        return q;
    }

    // Greifpunkt: Zellmitte, bei Verdeckung durch spaeter gezeichnete (obenliegende) Teile seitlich versetzt
    function pickPoint(id, half) {
        const p = rec.pieces.get(id);
        const offs = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.3, 0.3], [-0.3, -0.3]];
        for (const [ox, oy] of offs) {
            const x = p.x + ox * half * 2, y = p.y + oy * half * 2;
            let covered = false;
            for (const [oid, q] of rec.pieces) {
                if (oid !== id && q.t > p.t && Math.abs(x - q.x) < half * 0.85 && Math.abs(y - q.y) < half * 0.85) { covered = true; break; }
            }
            if (!covered) return { x, y };
        }
        return { x: p.x, y: p.y };
    }

    // Zieht Teil id so, dass seine Zellmitte auf (tx, ty) landet; prueft das Ergebnis und versucht es erneut
    async function movePiece(cv, id, tx, ty, pitch, verify = CFG.VERIFY) {
        if (!verify) {
            // Ohne Pruefung: ziehen, ein Bild warten, sofort weiter (Kontrolle am Rundenende)
            const p0 = rec.pieces.get(id);
            const g0 = pickPoint(id, pitch / 2);
            const t0 = Date.now();
            await drag(cv, g0, { x: g0.x + (tx - p0.x), y: g0.y + (ty - p0.y) });
            await frame();
            return { ok: null, q: null, err: NaN, tries: 1, tDrag: Date.now() - t0, tSet: 0 };
        }
        let q = null, err = Infinity, tries = 0, tDrag = 0, tSet = 0;
        for (; tries < CFG.TRIES; tries++) {
            const p = rec.pieces.get(id);
            const g = pickPoint(id, pitch / 2);
            const t1 = Date.now();
            await drag(cv, g, { x: g.x + (tx - p.x), y: g.y + (ty - p.y) });
            const t2 = Date.now();
            q = await settle(id, tx, ty, pitch);
            tSet += Date.now() - t2; tDrag += t2 - t1;
            err = q ? Math.hypot(q.x - tx, q.y - ty) : Infinity;
            if (err < CFG.TOL * pitch) { tries++; break; }
        }
        return { ok: err < CFG.TOL * pitch, q, err, tries, tDrag, tSet };
    }

    // ---------- Loesen ----------
    async function run(cv, cols, rows, setStatus) {
        const N = cols * rows;
        trace(`Auto Solver v${VERSION}, ${cols}x${rows} = ${N} Teile, Tempo "${CFG.SPEED}" ${JSON.stringify(PRESETS[CFG.SPEED])}`);
        if (typeof CanvasRenderingContext2D.prototype.getTransform !== 'function') throw new Error('Browser unterstuetzt getTransform nicht.');

        // 1) Jigidi muss genau N Teile erzeugen, sonst stimmt die Zuordnung Teil -> Position nicht
        for (let i = 0; i < 40 && rec.sizes.length < N; i++) { await sleep(500); setStatus(`Warte auf Teile ... ${rec.sizes.length}/${N}`); }
        await sleep(2500);
        setStatus(`Panel: ${cols}x${rows} = ${N} Teile, Jigidi hat ${rec.sizes.length} Teile erzeugt.`);
        if (rec.sizes.length !== N) {
            throw new Error(`Panel sagt ${cols}x${rows} = ${N} Teile, Jigidi hat aber ${rec.sizes.length} erzeugt. Zuordnung waere falsch.`);
        }
        buildIds();
        if (rec.dupes.length) trace(`Hinweis: gleiche Teilegroessen (${rec.dupes.join(', ')}), Zuordnung ueber die Teil-Canvas (${rec.tagged}/${N} erkannt).`);

        // 2) Auf Spielstart und auf die ersten Zeichenaufrufe warten
        const bodyEl = document.getElementById('body') || document.body;
        for (let t = 0; t < 120 && /game-loading|mode-init/.test(bodyEl.className); t++) {
            setStatus(`Warte auf Spielstart ... Falls noetig im Spiel auf Start klicken. Status: ${bodyEl.className.replace(/\s+/g, ' ')}`);
            await sleep(500);
        }
        for (let t = 0; t < 60 && rec.pieces.size < N; t++) {
            setStatus(`Warte auf gezeichnete Teile ... ${rec.pieces.size}/${N}`);
            await sleep(500);
        }
        if (rec.pieces.size < N) {
            throw new Error(`Nur ${rec.pieces.size}/${N} Teile konnten zugeordnet werden (Teil-Canvas erkannt: ${rec.tagged}, gleiche Groessen: ${rec.dupes.join(', ') || 'keine'}).`);
        }

        // 3) Teilegroesse auf dem Bildschirm = Zellgroesse im Teilebild x Massstab
        const first = rec.pieces.get(0);
        const scale = first.s;
        const manual = store.get('pitch', 0);
        if (!isFinite(rec.minOff)) throw new Error('Zellgroesse konnte nicht bestimmt werden.');
        const pitch = manual > 0 ? manual : 2 * rec.minOff * scale;
        trace(`Teile: ${N}, Massstab ${scale.toFixed(3)}, Zelle im Bild ${(2 * rec.minOff).toFixed(0)}px -> Raster ${pitch.toFixed(1)}px ${manual > 0 ? '(manuell)' : ''}`);

        // 4) Brettmitte = Mittelpunkt der aktuell verstreuten Teile, Anker = mittlere Zelle
        let mx = 0, my = 0;
        for (const p of rec.pieces.values()) { mx += p.x; my += p.y; }
        mx /= N; my /= N;
        const ac = Math.round((cols - 1) / 2), ar = Math.round((rows - 1) / 2), aId = ar * cols + ac;
        const ax = mx + (ac - (cols - 1) / 2) * pitch, ay = my + (ar - (rows - 1) / 2) * pitch;

        setStatus('Setze Ankerteil ...');
        const a0 = rec.pieces.get(aId);
        const ra = await movePiece(cv, aId, ax, ay, pitch, true);
        trace(`Anker ${aId}: war ${a0.x.toFixed(0)},${a0.y.toFixed(0)} -> ${ra.q.x.toFixed(0)},${ra.q.y.toFixed(0)} (Ziel ${ax.toFixed(0)},${ay.toFixed(0)}, Versuche ${ra.tries})`);
        trace(`Bilddauer auf dieser Seite im Schnitt ${perf.frames ? (perf.ms / perf.frames).toFixed(0) : '?'}ms (Ankerzug: Ziehen ${ra.tDrag}ms + Setzen ${ra.tSet}ms)`);

        const order = [];
        for (let id = 0; id < N; id++) if (id !== aId) order.push(id);
        order.sort((a, b) =>
            (Math.abs(a % cols - ac) + Math.abs(Math.floor(a / cols) - ar)) -
            (Math.abs(b % cols - ac) + Math.abs(Math.floor(b / cols) - ar)));

        // Wartet, bis sich keine Teilposition mehr aendert (Jigidi laesst losgelassene Teile noch einrasten)
        const quiet = async (maxMs = 4000) => {
            const sig = () => { let v = 0; for (const q of rec.pieces.values()) v += q.x * 3 + q.y; return v; };
            let last = sig();
            const t0 = Date.now();
            for (;;) {
                await sleep(300);
                const cur = sig();
                if (Math.abs(cur - last) < 0.5 || Date.now() - t0 > maxMs) return;
                last = cur;
            }
        };
        const countPlaced = () => {
            const A = rec.pieces.get(aId);
            let n = 1;
            for (const id of order) {
                const q = rec.pieces.get(id);
                const tx = A.x + (id % cols - ac) * pitch, ty = A.y + (Math.floor(id / cols) - ar) * pitch;
                if (q && Math.hypot(q.x - tx, q.y - ty) < CFG.TOL * pitch) n++;
            }
            return n;
        };

        const stats = { ms: 0, moved: 0, retries: 0, miss: 0 };
        const tStart = Date.now();
        let placed = 0;
        for (let round = 1; round <= CFG.ROUNDS; round++) {
            let moved = 0;
            for (const id of order) {
                const c = id % cols, r = Math.floor(id / cols);
                const A = rec.pieces.get(aId);
                const tx = A.x + (c - ac) * pitch, ty = A.y + (r - ar) * pitch;
                const p = rec.pieces.get(id);
                if (Math.hypot(p.x - tx, p.y - ty) < CFG.TOL * pitch) continue;

                const tp = Date.now();
                const res = await movePiece(cv, id, tx, ty, pitch);
                const ms = Date.now() - tp;
                stats.ms += ms; stats.moved++; stats.retries += res.tries - 1; moved++;
                if (res.ok === false) stats.miss++;
                const tail = res.q
                    ? `-> ${res.q.x.toFixed(0)},${res.q.y.toFixed(0)} (Fehler ${res.err.toFixed(0)}px, ${res.tries}x, ${ms}ms = Ziehen ${res.tDrag} + Setzen ${res.tSet}) ${res.ok ? 'OK' : 'daneben'}`
                    : `(${ms}ms, Pruefung am Rundenende)`;
                trace(`R${round} Teil ${id} (Sp${c + 1}/Z${r + 1}): von ${p.x.toFixed(0)},${p.y.toFixed(0)} Ziel ${tx.toFixed(0)},${ty.toFixed(0)} ${tail}`);
                setStatus(`Runde ${round}/${CFG.ROUNDS}: ${moved} Teile bewegt`);
            }
            setStatus(`Runde ${round}/${CFG.ROUNDS}: warte, bis alle Teile eingerastet sind ...`);
            await quiet();
            placed = countPlaced();
            trace(`Runde ${round}: ${placed}/${N} platziert (${moved} Teile in dieser Runde bewegt)`);
            setStatus(`Runde ${round}/${CFG.ROUNDS}: ${placed}/${N} platziert`);
            if (placed >= N) break;
        }
        trace(`Zusammenfassung: ${placed}/${N} platziert in ${((Date.now() - tStart) / 1000).toFixed(1)}s, ` +
            `${stats.moved} Zuege (${stats.moved ? (stats.ms / stats.moved).toFixed(0) : 0}ms pro Zug), ` +
            `${stats.retries} Wiederholungen, ${stats.miss} daneben, Bilddauer im Schnitt ${perf.frames ? (perf.ms / perf.frames).toFixed(0) : '?'}ms (${perf.frames} Bilder)`);
        return placed;
    }

    // ---------- Protokolldatei ----------
    function buildLog(reason) {
        return [
            `Jigidi Auto Solver v${VERSION} - Protokoll (${reason})`,
            `Zeit: ${new Date().toISOString()}`,
            `Seite: ${location.href}`,
            `Browser: ${navigator.userAgent}`,
            `Einstellungen: Tempo ${CFG.SPEED}, Runden ${CFG.ROUNDS}, Versuche ${CFG.TRIES}, Toleranz ${CFG.TOL}`,
            ''
        ].concat(logLines).join('\n') + '\n';
    }

    function download(text) {
        const d = new Date(), z = n => String(n).padStart(2, '0');
        const name = `jigidi-protokoll-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.txt`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        return name;
    }

    function saveLog(reason) {
        const text = logLines.length ? buildLog(reason) : store.get('lastlog', '');
        if (!text) return null;
        if (logLines.length) store.set('lastlog', text);
        return download(text);
    }

    // ---------- UI + Start ----------
    function start() {
        if (!document.cookie.split(';').some(c => c.trim().startsWith('access-token='))) return;
        const info = document.getElementById('tool-info-panel');
        if (!info) return;
        const dim = info.innerText.match(/(\d+)×(\d+)/);
        if (!dim) return;
        const cols = parseInt(dim[1]), rows = parseInt(dim[2]);
        const N = cols * rows;

        const box = document.createElement('div');
        box.id = 'jigidi-auto-solver';
        box.innerHTML = `
            <hr>
            <strong>Auto Solver (experimentell)</strong>
            <div style="display:flex;gap:.5rem;align-items:center;margin:.5rem 0;">
                <button class="btn em" id="jas-go"><span style="font-weight:bold;cursor:pointer;">Auto-Solve</span></button>
                <label style="font-size:.85rem;">Tempo
                    <select id="jas-speed" style="color:black;">
                        <option value="normal">normal</option>
                        <option value="schnell">schnell</option>
                        <option value="maximal">maximal</option>
                    </select>
                </label>
                <label style="font-size:.85rem;">Raster px (0=auto)
                    <input id="jas-pitch" type="number" min="0" value="${store.get('pitch', 0)}" style="width:5rem;color:black;">
                </label>
            </div>
            <div style="display:flex;gap:.5rem;margin-bottom:.5rem;">
                <button class="btn" id="jas-stop" disabled title="Stoppt den Lauf (auch mit der Esc-Taste)">Stop (Esc)</button>
                <button class="btn" id="jas-save">Protokoll speichern (.txt)</button>
            </div>
            <div id="jas-status" style="font-size:.85rem;"></div>
            <pre id="jas-log" title="Klick = alles markieren" style="font-size:.7rem;max-height:14rem;overflow:auto;white-space:pre-wrap;user-select:all;margin:.5rem 0;"></pre>
            <hr>`;
        info.after(box);
        const status = document.getElementById('jas-status');
        const setStatus = t => { status.textContent = t; };
        const logBox = document.getElementById('jas-log');
        const lines = [];
        traceFn = t => { lines.push(t); logBox.textContent += t + '\n'; logBox.scrollTop = logBox.scrollHeight; };
        document.getElementById('jas-speed').value = CFG.SPEED;
        document.getElementById('jas-save').addEventListener('click', () => {
            const n = saveLog('manuell');
            setStatus(n ? `Protokoll gespeichert: ${n}` : 'Noch kein Protokoll vorhanden.');
        });

        document.getElementById('jas-go').addEventListener('click', () => {
            store.set('pitch', parseFloat(document.getElementById('jas-pitch').value) || 0);
            store.set('speed', document.getElementById('jas-speed').value);
            store.set('run', true);
            window.location.reload();
        });

        if (!state.active) return;

        const stopBtn = document.getElementById('jas-stop');
        stopBtn.disabled = false;
        const requestStop = () => {
            if (stopRequested) return;
            stopRequested = true;
            stopBtn.disabled = true;
            setStatus('Stoppe ...');
        };
        stopBtn.addEventListener('click', requestStop);
        window.addEventListener('keydown', e => { if (e.key === 'Escape') requestStop(); }, true);

        setStatus('Auto-Modus gestartet, suche Canvas ...');
        (async () => {
            try {
                let cv = null;
                for (let t = 0; t < 60 && !cv; t++) {
                    const cs = [...document.querySelectorAll('canvas')];
                    cs.sort((a, b) => b.width * b.height - a.width * a.height);
                    cv = cs[0] || null;
                    if (!cv) await sleep(500);
                }
                if (!cv) throw new Error('Kein Canvas gefunden.');
                const placed = await run(cv, cols, rows, setStatus);
                const bodyCls = (document.getElementById('body') || document.body).className.replace(/\s+/g, ' ');
                stopBtn.disabled = true;
                trace(`Fertig: ${placed}/${N} Teile platziert. Spielstatus: ${bodyCls}.`);
                const fn = saveLog('fertig');
                setStatus(`Fertig: ${placed}/${N} Teile platziert. Spielstatus: ${bodyCls}.${fn ? ' Protokoll: ' + fn : ''}`);
            } catch (e) {
                // Falls mitten im Zug gestoppt wurde: Maustaste loslassen, damit Jigidi kein Teil festhaelt
                if (held) { fire(held.cv, 'up', held.x, held.y, 0); held = null; }
                stopBtn.disabled = true;
                if (e.message === 'STOP') {
                    trace('Vom Benutzer gestoppt.');
                    const fn = saveLog('gestoppt');
                    setStatus('Gestoppt.' + (fn ? ' Protokoll: ' + fn : '') + ' Zum erneuten Start auf Auto-Solve klicken.');
                    return;
                }
                console.error('[AutoSolver]', e);
                trace('FEHLER: ' + e.message);
                const fn = saveLog('fehler');
                setStatus('Fehler: ' + e.message + (fn ? ' (Protokoll: ' + fn + ')' : ''));
            }
        })();
    }

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start);
})();
