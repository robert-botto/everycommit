// <every-commit src="activity.json" attestation-repo="owner/repo"></every-commit>
//
// The Reveal: starts as what GitHub shows on one profile, then adds every proven account, then
// every verified commit. One file, no dependencies, Shadow DOM so the host page's CSS can't leak in.
// Styles use a constructed stylesheet, so a strict Content-Security-Policy needs no 'unsafe-inline'.
//
// Theming: set --ec-accent, --ec-bg, --ec-text, --ec-muted, --ec-line and --ec-empty on the element.

const CSS = `
:host { --ec-accent: #2f5bff; --ec-bg: #f7f7f4; --ec-text: #1e2023; --ec-muted: #5f646b; --ec-line: #d3d5cf; --ec-empty: #dfe0db;
  display: block; font-family: var(--ec-font, system-ui, sans-serif); color: var(--ec-text); }
@media (prefers-color-scheme: dark) { :host { --ec-accent: #7d97ff; --ec-bg: #212429; --ec-text: #ecedea; --ec-muted: #a0a6ae; --ec-line: #2e3238; --ec-empty: #262a30; } }
.card { background: var(--ec-bg); border-radius: 14px; padding: clamp(1rem, 3vw, 2rem); }
.count { font-size: clamp(2.6rem, 8vw, 5rem); font-weight: 800; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.head { display: flex; align-items: baseline; gap: .9rem; flex-wrap: wrap; margin: 0; }
.delta { font-weight: 700; color: var(--ec-accent); opacity: 0; transform: translateY(6px); transition: opacity .5s, transform .5s; }
.delta.on { opacity: 1; transform: none; }
.caption { margin: .5rem 0 1.4rem; color: var(--ec-muted); min-height: 1.5em; }
.wrap { overflow-x: auto; padding-bottom: .3rem; }
.grid { --s: clamp(8px, 1.4vw, 13px); display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, var(--s));
  grid-auto-columns: var(--s); gap: 3px; width: max-content; }
.cell { border-radius: 3px; background: var(--ec-empty); transition: background-color .55s, box-shadow .55s; }
.cell.pad { visibility: hidden; }
.cell.lit { box-shadow: 0 0 0 1.5px var(--ec-accent), 0 0 9px 1px color-mix(in srgb, var(--ec-accent) 55%, transparent); }
.steps { display: flex; gap: .45rem; flex-wrap: wrap; margin-top: 1.3rem; }
button { font: inherit; font-size: .85rem; font-weight: 600; border: 1px solid var(--ec-line); background: transparent; color: var(--ec-text);
  border-radius: 5px; padding: .45rem .75rem; cursor: pointer; }
button[aria-pressed="true"] { background: var(--ec-text); color: var(--ec-bg); border-color: var(--ec-text); }
button.replay { margin-left: auto; }
.foot { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-top: 1.3rem; padding-top: 1rem;
  border-top: 1px solid var(--ec-line); font-size: .8rem; color: var(--ec-muted); }
.seal { display: inline-flex; align-items: center; gap: .4rem; border: 1px dashed currentColor; border-radius: 999px; padding: .25rem .65rem; color: inherit; text-decoration: none; }
.seal i { width: .5rem; height: .5rem; border-radius: 50%; background: #c58a00; }
.seal b { font-weight: 600; color: var(--ec-text); }
.seal .sig::before { content: '\00b7'; margin-right: .4rem; }
.seal.signed { border-style: solid; color: var(--ec-text); }
.seal.signed i { background: #1f9d55; }
.tip { position: fixed; pointer-events: none; background: var(--ec-text); color: var(--ec-bg); font-size: .78rem; padding: .5rem .65rem;
  border-radius: 6px; line-height: 1.45; opacity: 0; transition: opacity .12s; z-index: 9; font-variant-numeric: tabular-nums; }
.tip.on { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .cell, .delta { transition: none; } }
`;

const fmt = (n) => n.toLocaleString('en-US');
const sum = (cells) => cells.reduce((a, b) => a + b, 0);

class EveryCommit extends HTMLElement {
  static observedAttributes = ['src'];

  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    this.load();
  }

  attributeChangedCallback(name, before, after) {
    if (this.shadowRoot && before !== after) this.load();
  }

  async load() {
    const src = this.getAttribute('src') ?? 'activity.json';
    try {
      const response = await fetch(src);
      const bytes = await response.arrayBuffer();
      const doc = JSON.parse(new TextDecoder().decode(bytes));
      this.render(doc);
      this.checkSeal(bytes);
    } catch (error) {
      this.shadowRoot.textContent = `everycommit: could not load ${src} (${error.message})`;
    }
  }

  render(doc) {
    const root = this.shadowRoot;
    const proven = doc.series.githubCalendars.filter((c) => c.proven);
    const days = doc.series.verifiedCommits.length;
    const add = (lists) => Array.from({ length: days }, (_, i) => lists.reduce((total, cells) => total + cells[i], 0));
    this.stages = [
      { name: 'What GitHub shows', cells: proven[0]?.cells ?? new Array(days).fill(0),
        caption: 'What one GitHub profile shows a visitor.' },
      { name: 'Every account', cells: add(proven.map((c) => c.cells)),
        caption: `All ${proven.length} accounts together. GitHub never combines them.` },
      { name: 'Every commit', cells: doc.series.contributions,
        caption: 'Plus every verified commit GitHub missed: all branches, deduplicated, filtered for faked commits.' },
    ];
    if (proven.length < 2) this.stages.splice(1, 1);
    this.totals = this.stages.map((s) => sum(s.cells));
    this.doc = doc;

    const nonzero = this.stages.flatMap((s) => s.cells).filter((n) => n > 0).sort((a, b) => a - b);
    const q = (p) => nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))] ?? 0;
    const cuts = [q(0.25), q(0.5), q(0.8)];
    const mix = [0, 30, 55, 78, 100];
    this.color = (n) => {
      const level = n === 0 ? 0 : n <= cuts[0] ? 1 : n <= cuts[1] ? 2 : n <= cuts[2] ? 3 : 4;
      return level === 0 ? 'var(--ec-empty)' : `color-mix(in srgb, var(--ec-accent) ${mix[level]}%, var(--ec-empty))`;
    };

    root.innerHTML = `<div class="card">
      <h2 class="head"><span class="count" aria-live="polite">0</span><span class="delta"></span></h2>
      <p class="caption"></p>
      <div class="wrap"><div class="grid" role="img" aria-label="Contribution calendar"></div></div>
      <div class="steps"></div>
      <div class="foot"><span class="meta"></span><a class="seal" target="_blank" rel="noopener"><i></i><b>&#10003; Verified emails</b><span class="sig">Unsigned</span></a></div>
      <div class="tip"></div></div>`;
    const grid = root.querySelector('.grid');
    const start = new Date(`${doc.from}T12:00:00Z`);
    for (let i = 0; i < start.getUTCDay(); i++) grid.append(Object.assign(document.createElement('div'), { className: 'cell pad' }));
    this.cells = Array.from({ length: days }, (_, i) => {
      const cell = Object.assign(document.createElement('div'), { className: 'cell' });
      cell.dataset.i = i;
      grid.append(cell);
      return cell;
    });

    const steps = root.querySelector('.steps');
    this.stages.forEach((stage, s) => {
      const button = Object.assign(document.createElement('button'), { textContent: `${s + 1}. ${stage.name}` });
      button.addEventListener('click', () => { this.stop(); this.show(s); });
      steps.append(button);
    });
    const replay = Object.assign(document.createElement('button'), { className: 'replay', textContent: 'Replay' });
    replay.addEventListener('click', () => this.reveal());
    steps.append(replay);

    const t = doc.totals;
    root.querySelector('.meta').textContent = `Updated ${doc.to} · ${fmt(t.mergedPullRequests)} merged pull requests`;

    this.bindTooltip(grid, start);
    this.timers = [];
    this.current = -1;
    this.shown = 0;
    new IntersectionObserver((entries, observer) => {
      if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); this.reveal(); }
    }, { threshold: 0.4 }).observe(this);
  }

  show(stage) {
    const root = this.shadowRoot;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const before = this.current >= 0 ? this.stages[this.current].cells : null;
    const now = this.stages[stage].cells;
    const growing = stage > this.current;
    this.current = stage;
    this.cells.forEach((cell, i) => {
      const delay = reduced ? 0 : Math.floor(i / 7) * 16;
      setTimeout(() => {
        cell.style.backgroundColor = this.color(now[i]);
        cell.classList.toggle('lit', Boolean(before) && growing && now[i] > before[i]);
      }, delay);
    });
    this.count(this.totals[stage], reduced ? 0 : stage === 0 ? 900 : 1400);
    root.querySelector('.caption').textContent = this.stages[stage].caption;
    const delta = root.querySelector('.delta');
    const extra = this.totals[stage] - this.totals[0];
    delta.textContent = stage === 0 || this.totals[0] === 0 || extra <= 0 ? ''
      : `+${fmt(extra)} GitHub doesn't show (+${Math.round((extra / this.totals[0]) * 100)}%)`;
    delta.classList.toggle('on', Boolean(delta.textContent));
    [...root.querySelectorAll('.steps button:not(.replay)')].forEach((b, s) => b.setAttribute('aria-pressed', String(s === stage)));
  }

  count(to, ms) {
    cancelAnimationFrame(this.raf);
    const el = this.shadowRoot.querySelector('.count');
    const from = this.shown;
    const t0 = performance.now();
    const tick = (now) => {
      const p = ms ? Math.min(1, (now - t0) / ms) : 1;
      this.shown = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      el.textContent = fmt(this.shown);
      if (p < 1) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() { this.timers.forEach(clearTimeout); this.timers = []; }

  reveal() {
    this.stop();
    this.current = -1;
    this.shown = 0;
    this.show(0);
    for (let s = 1; s < this.stages.length; s++) this.timers.push(setTimeout(() => this.show(s), s * 2700));
  }

  bindTooltip(grid, start) {
    const tip = this.shadowRoot.querySelector('.tip');
    grid.addEventListener('pointermove', (event) => {
      const cell = event.target.closest('.cell:not(.pad)');
      if (!cell) return tip.classList.remove('on');
      const i = Number(cell.dataset.i);
      const date = new Date(start.getTime() + i * 86_400_000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      const lines = this.stages.map((s) => `${s.name}: ${fmt(s.cells[i])}`);
      tip.innerHTML = `<strong>${date}</strong><br>${lines.join('<br>')}`;
      tip.style.left = `${Math.min(innerWidth - 220, event.clientX + 14)}px`;
      tip.style.top = `${event.clientY + 14}px`;
      tip.classList.add('on');
    });
    grid.addEventListener('pointerleave', () => tip.classList.remove('on'));
  }

  // A light, in-browser check: is there a GitHub attestation for exactly these bytes in the
  // publishing repository? The full cryptographic check (signature, and that the signer was the
  // official everycommit workflow) is `npx everycommit verify`, linked from the badge.
  async checkSeal(bytes) {
    const repo = this.getAttribute('attestation-repo');
    const seal = this.shadowRoot.querySelector('.seal');
    if (!repo) return;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    seal.href = `https://github.com/${repo}/attestations`;
    seal.title = `Full check: npx everycommit verify activity.json --repo ${repo}`;
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/attestations/sha256:${digest}`);
      const body = response.ok ? await response.json() : null;
      if (body?.attestations?.length) {
        seal.classList.add('signed');
        seal.querySelector('b').textContent = '\u2713 Verified';
        seal.querySelector('.sig').textContent = 'Signed';
      }
    } catch {
      // Offline or rate limited: leave the badge as "Unsigned" rather than claim anything.
    }
  }
}

if (!customElements.get('every-commit')) customElements.define('every-commit', EveryCommit);
