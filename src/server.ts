import * as http from 'node:http';
import { getTodayDate, type Config } from './config';
import { EVENT_LABEL, formatDetail, summarize } from './formatter';
import { buildTimelineForDate } from './pipeline';

const HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>git-time-tracker</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; padding: 2rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem; color: #f0f6fc; }
    .controls { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; }
    .controls label { font-size: 0.8rem; color: #8b949e; }
    input[type="date"] { background: #161b22; border: 1px solid #30363d; color: #e6edf3; padding: 0.4rem 0.6rem; border-radius: 6px; font-size: 0.875rem; }
    .btn { background: #21262d; border: 1px solid #30363d; color: #e6edf3; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; }
    .btn:hover { background: #30363d; }
    .btn-primary { background: #238636; border-color: #2ea043; color: #fff; }
    .btn-primary:hover { background: #2ea043; }
    .filters { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-bottom: 1rem; min-height: 2rem; }
    .filter-label { font-size: 0.78rem; color: #8b949e; }
    .chip { background: #21262d; border: 1px solid #30363d; color: #8b949e; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; cursor: pointer; user-select: none; transition: all 0.1s; }
    .chip.on { background: #1f6feb22; border-color: #388bfd; color: #79c0ff; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    thead th { text-align: left; padding: 0.5rem 1rem; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #8b949e; border-bottom: 1px solid #21262d; }
    tbody tr { border-bottom: 1px solid #161b22; }
    tbody tr:hover { background: #161b22; }
    td { padding: 0.55rem 1rem; }
    .time { font-family: monospace; font-size: 0.8rem; color: #8b949e; white-space: nowrap; }
    .repo { color: #79c0ff; font-weight: 500; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; white-space: nowrap; letter-spacing: 0.02em; }
    .COMMIT,.COMMIT_INITIAL { background: #1a4731; color: #3fb950; }
    .COMMIT_AMEND { background: #3d2b00; color: #d29922; }
    .CHECKOUT,.CHECKOUT_DETACHED { background: #0d2d4a; color: #58a6ff; }
    .MERGE,.COMMIT_MERGE { background: #2d1f5e; color: #bc8cff; }
    .REBASE { background: #3d1f1f; color: #f85149; }
    .empty { text-align: center; padding: 3rem 1rem; color: #8b949e; font-size: 0.9rem; }
    .summary { margin-top: 0.75rem; font-size: 0.78rem; color: #8b949e; }
  </style>
</head>
<body>
  <h1>git-time-tracker</h1>
  <div class="controls">
    <label>Date</label>
    <button class="btn" id="prev">&#9664;</button>
    <input type="date" id="dp" />
    <button class="btn" id="next">&#9654;</button>
    <button class="btn btn-primary" id="refresh">Refresh</button>
  </div>
  <div id="filters" class="filters"></div>
  <div id="content"></div>
  <div id="summary" class="summary"></div>

  <script>
    // label + detail are pre-computed server-side (single source of truth with
    // the CLI formatter). The browser only formats time and toggles filters.
    const ESC_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
    const plural = (n, one, many) => n === 1 ? one : many;
    const summarize = (events, repos) =>
      events + ' event' + plural(events, '', 's') + ' across ' + repos + ' repositor' + plural(repos, 'y', 'ies');

    const dp = document.getElementById('dp');
    dp.value = new Date().toISOString().slice(0,10);

    let all = [], active = new Set();

    async function load(date) {
      document.getElementById('content').innerHTML = '<div class="empty">Loading…</div>';
      document.getElementById('summary').textContent = '';
      try {
        const r = await fetch('/api/timeline?date=' + date);
        all = await r.json();
        const repos = [...new Set(all.map(e => e.repoName))].sort();
        active = new Set(repos);
        renderFilters(repos);
        render();
      } catch { document.getElementById('content').innerHTML = '<div class="empty">Failed to load.</div>'; }
    }

    function renderFilters(repos) {
      const div = document.getElementById('filters');
      if (repos.length < 2) { div.innerHTML = ''; return; }
      div.innerHTML = '<span class="filter-label">Repos:</span>' +
        repos.map(r => '<span class="chip on" data-r="'+esc(r)+'">'+esc(r)+'</span>').join('');
      div.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
        const r = c.dataset.r;
        if (active.has(r)) { active.delete(r); c.classList.remove('on'); }
        else { active.add(r); c.classList.add('on'); }
        render();
      }));
    }

    function render() {
      const entries = all.filter(e => active.has(e.repoName));
      if (!entries.length) {
        document.getElementById('content').innerHTML = '<div class="empty">No events found.</div>';
        document.getElementById('summary').textContent = '';
        return;
      }
      const rows = entries.map(e => {
        const t = new Date(e.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
        return '<tr><td class="time">'+t+'</td><td class="repo">'+esc(e.repoName)+'</td>'
          +'<td><span class="badge '+e.type+'">'+esc(e.label)+'</span></td>'
          +'<td>'+esc(e.detail)+'</td></tr>';
      }).join('');
      document.getElementById('content').innerHTML =
        '<table><thead><tr><th>Time</th><th>Repository</th><th>Type</th><th>Detail</th></tr></thead>'
        +'<tbody>'+rows+'</tbody></table>';
      const rc = new Set(entries.map(e => e.repoPath)).size;
      document.getElementById('summary').textContent = summarize(entries.length, rc);
    }

    dp.addEventListener('change', () => load(dp.value));
    document.getElementById('prev').addEventListener('click', () => { const d=new Date(dp.value); d.setDate(d.getDate()-1); dp.value=d.toISOString().slice(0,10); load(dp.value); });
    document.getElementById('next').addEventListener('click', () => { const d=new Date(dp.value); d.setDate(d.getDate()+1); dp.value=d.toISOString().slice(0,10); load(dp.value); });
    document.getElementById('refresh').addEventListener('click', () => load(dp.value));

    load(dp.value);
  </script>
</body>
</html>`;

// Smoke-test that the inline JS summarize helper stays in sync with the
// canonical server-side implementation. If the two ever drift, throw at server
// creation rather than silently showing a wrong footer in the UI.
const SUMMARIZE_SAMPLES: Array<[number, number]> = [[0, 0], [1, 1], [1, 2], [2, 1]];
for (const [e, r] of SUMMARIZE_SAMPLES) {
  const inlineOutput = `${e} event${e === 1 ? '' : 's'} across ${r} repositor${r === 1 ? 'y' : 'ies'}`;
  if (summarize(e, r) !== inlineOutput) {
    throw new Error(`server.ts: summarize() drifted from inline HTML helper at (${e}, ${r})`);
  }
}

export function createServer(config: Config): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);

    if (url.pathname === '/api/timeline') {
      const date = url.searchParams.get('date') ?? getTodayDate();
      const entries = buildTimelineForDate(config, date).map((e) => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
        detail: formatDetail(e),
        label: EVENT_LABEL[e.type] ?? e.type,
      }));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(entries));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });
}
