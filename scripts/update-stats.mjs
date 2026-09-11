import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const username = 'Qziky';
const assets = new URL('../assets/', import.meta.url);
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[char]));

function api(endpoint, paginate = false) {
  // Retry transient transport failures; never replace saved cards with partial data.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return JSON.parse(execFileSync('gh', ['api', endpoint, ...(paginate ? ['--paginate', '--slurp'] : [])], {
        encoding: 'utf8', timeout: 30000, maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
    } catch (error) {
      if (attempt === 3) throw new Error(`GitHub request failed: ${endpoint}`, { cause: error });
    }
  }
}

const user = api(`users/${username}`);
const repositories = api(`users/${username}/repos?type=owner&per_page=100&sort=full_name`, true)
  .flat().filter((repo) => !repo.private && !repo.fork);
const languages = new Map();
for (const repository of repositories) {
  const result = api(`repos/${repository.full_name}/languages`);
  for (const [name, bytes] of Object.entries(result)) {
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Invalid language byte count');
    languages.set(name, (languages.get(name) ?? 0) + bytes);
  }
}
if (!Number.isFinite(user.followers)) throw new Error('Invalid follower count');
const date = new Date().toISOString().slice(0, 10);
const label = (x, y, value, className = '') => `<text x="${x}" y="${y}" class="${className}">${escape(value)}</text>`;
function card(title, description, content, footer) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="190" viewBox="0 0 420 190" role="img" aria-labelledby="title description">
  <title id="title">${escape(title)}</title>
  <desc id="description">${escape(description)}</desc>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; fill: #e2e8f0; font-size: 13px; }
    .title { fill: #38bdf8; font-size: 18px; font-weight: 600; }
    .value { fill: #ffffff; font-size: 25px; font-weight: 700; }
    .muted { fill: #a6b6cc; font-size: 11px; }
  </style>
  <rect width="420" height="190" rx="8" fill="#0f172a" />
  ${label(22, 33, title, 'title')}
  ${content}
  ${label(22, 174, footer, 'muted')}
</svg>\n`;
}

const stars = repositories.reduce((sum, repo) => sum + repo.stargazers_count, 0);
const forks = repositories.reduce((sum, repo) => sum + repo.forks_count, 0);
const metrics = [['原创仓库', repositories.length], ['获得 Star', stars], ['获得 Fork', forks], ['关注者', user.followers]];
const metricsContent = metrics.map(([name, value], index) => {
  const x = 22 + (index % 2) * 205;
  const y = 76 + Math.floor(index / 2) * 56;
  return label(x, y, value.toLocaleString('en-US'), 'value') + label(x + 68, y - 3, name);
}).join('\n  ');
const stats = card(`${username} / GitHub`, metrics.map(([name, value]) => `${name} ${value}`).join('，'), metricsContent, `公开原创仓库 · ${date} UTC`);

const sorted = [...languages].filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const total = sorted.reduce((sum, [, bytes]) => sum + bytes, 0);
const displayed = sorted.length > 6 ? [...sorted.slice(0, 5), ['Other', sorted.slice(5).reduce((sum, [, bytes]) => sum + bytes, 0)]] : sorted;
const colors = ['#38bdf8', '#f6c85f', '#a78bfa', '#4ade80', '#fb7185', '#94a3b8'];
let offset = 22;
const bars = displayed.map(([, bytes], index) => {
  const width = bytes / total * 376;
  const bar = `<rect x="${offset.toFixed(3)}" y="52" width="${width.toFixed(3)}" height="10" fill="${colors[index]}" />`;
  offset += width;
  return bar;
}).join('\n  ');
const legend = displayed.map(([name, bytes], index) => {
  const x = 22 + (index % 2) * 194;
  const y = 91 + Math.floor(index / 2) * 24;
  return `<circle cx="${x + 4}" cy="${y - 4}" r="4" fill="${colors[index]}" />` + label(x + 14, y, `${name} ${(bytes / total * 100).toFixed(1)}%`);
}).join('\n  ');
const languageCard = card('Code / Languages', '公开原创仓库的语言占比，按 GitHub 代码字节数统计。', total ? bars + legend : label(22, 99, '暂无语言数据'), `代码字节占比 · ${date} UTC`);

// Fetch and render both cards successfully before writing either output.
await mkdir(assets, { recursive: true });
await writeFile(new URL('github-stats.svg', assets), stats);
await writeFile(new URL('top-languages.svg', assets), languageCard);
console.log(JSON.stringify({ repositories: repositories.length, stars, forks, followers: user.followers, languages: displayed.map(([name]) => name), date }));
