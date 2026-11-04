// A static SVG of the verified graph, for READMEs and anywhere scripts can't run.

const PALETTE = {
  light: { bg: '#f7f7f4', text: '#1e2023', muted: '#5f646b', levels: ['#dfe0db', '#c3cdf5', '#8ea4f7', '#5a7bfa', '#2f5bff'] },
  dark: { bg: '#212429', text: '#ecedea', muted: '#a0a6ae', levels: ['#262a30', '#2c3a6b', '#3d55b0', '#5f7cf0', '#9db0ff'] },
};

export function levels(cells) {
  const nonzero = cells.filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p) => nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.8)];
  return (n) => (n === 0 ? 0 : n <= cuts[0] ? 1 : n <= cuts[1] ? 2 : n <= cuts[2] ? 3 : 4);
}

const fmt = (n) => n.toLocaleString('en-US');
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function renderSvg(doc, { theme = 'light' } = {}) {
  const colors = PALETTE[theme] ?? PALETTE.light;
  const cells = doc.series.commits;
  const level = levels(cells);
  const size = 11, gap = 3, left = 20, top = 70;
  const pad = new Date(`${doc.from}T12:00:00Z`).getUTCDay();
  const weeks = Math.ceil((cells.length + pad) / 7);
  const width = left * 2 + weeks * (size + gap);
  const height = top + 7 * (size + gap) + 34;
  const rects = cells.map((n, i) => {
    const slot = i + pad;
    const x = left + Math.floor(slot / 7) * (size + gap);
    const y = top + (slot % 7) * (size + gap);
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="${colors.levels[level(n)]}"><title>${doc.from && dayLabel(doc.from, i)}: ${n}</title></rect>`;
  }).join('');
  const t = doc.totals;
  const title = `${fmt(t.commits)} commits`;
  const sub = `${fmt(t.addedBeyondGithub)} more than GitHub credits · ${fmt(t.activeDays)} active days · ${fmt(t.mergedPullRequests)} merged pull requests · ${doc.from} to ${doc.to}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">
<rect width="100%" height="100%" rx="10" fill="${colors.bg}"/>
<text x="${left}" y="36" font-family="system-ui, sans-serif" font-size="22" font-weight="800" fill="${colors.text}">${escape(title)}</text>
<text x="${left}" y="56" font-family="system-ui, sans-serif" font-size="12" fill="${colors.muted}">${escape(sub)}</text>
${rects}
<text x="${left}" y="${height - 12}" font-family="system-ui, sans-serif" font-size="11" fill="${colors.muted}">everycommit · every branch, every account, deduplicated, filtered for faked commits</text>
</svg>
`;
}

function dayLabel(from, i) {
  return new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
}
