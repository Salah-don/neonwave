// Hash router with one navigation stack per tab (Apple Music style).
import { $, $$ } from './util.js';

const routes = [];
export const TABS = ['home', 'browse', 'library', 'search'];
const tabRoot = (t) => `/${t}`;
const tabLast = Object.fromEntries(TABS.map((t) => [t, tabRoot(t)]));
const scrolls = new Map();
const titles = new Map();
let currentTab = 'home';
let currentPath = '';
let renderToken = 0;
let lastDepth = 0;

/** Register a route: pattern like '/album/:id'. view(page, params, ctx) renders into `page`. */
export function route(pattern, view) {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ re, view });
}

export const go = (path) => { location.hash = '#' + path; };
export const back = () => (history.length > 1 ? history.back() : go(tabRoot(currentTab)));
export const path = () => currentPath;
export const setTitle = (t) => titles.set(currentPath, t);
/** Title of the page we came from in this tab — used as the back button label. */
let backLabel = '';
export const getBackLabel = () => backLabel;

function depthOf(p) { return p.split('/').filter(Boolean).length; }

export async function render({ keepScroll = false } = {}) {
  const p = decodeURI(location.hash.slice(1)) || '/home';
  const seg = p.split('/')[1];
  const prevPath = currentPath;
  if (prevPath) scrolls.set(prevPath, scrollY);
  const switchingTab = TABS.includes(seg) && seg !== currentTab;
  if (TABS.includes(seg)) currentTab = seg;
  if (!keepScroll && prevPath !== p) backLabel = switchingTab ? '' : titles.get(prevPath) || '';
  tabLast[currentTab] = p;
  currentPath = p;
  $$('#tabbar .tab').forEach((a) => {
    const on = a.dataset.tab === currentTab;
    a.classList.toggle('active', on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });

  const match = routes.map((r) => ({ r, m: p.match(r.re) })).find((x) => x.m);
  const container = $('#views');
  const page = document.createElement('div');
  const depth = depthOf(p);
  page.className = 'page ' + (keepScroll ? '' : switchingTab ? 'fade' : depth >= lastDepth ? (prevPath === p ? '' : 'push') : 'pop');
  lastDepth = depth;
  const token = ++renderToken;
  const keepY = scrollY;
  try {
    const params = Object.fromEntries(Object.entries(match?.m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
    const isRoot = TABS.includes(seg) && depth === 1;
    // Build off-DOM first so refreshes don't flash an empty page.
    const fill = (match ? match.r.view : notFound)(page, params, { isRoot, tab: currentTab });
    if (!keepScroll) { container.replaceChildren(page); }
    await fill;
    if (token !== renderToken) return;
    if (keepScroll) container.replaceChildren(page);
  } catch (e) {
    if (token !== renderToken) return;
    page.innerHTML = `<div class="empty"><h3>Oups</h3><p>${String(e?.message || e).replace(/</g, '&lt;')}</p></div>`;
    container.replaceChildren(page);
  }
  requestAnimationFrame(() => scrollTo(0, keepScroll ? keepY : (switchingTab || prevPath === p ? scrolls.get(p) ?? 0 : depth < depthOf(prevPath || p) ? scrolls.get(p) ?? 0 : 0)));
}

/** Re-render the current page in place (data changed). */
export const refresh = () => render({ keepScroll: true });

async function notFound(page) {
  page.innerHTML = '<div class="empty"><h3>Page introuvable</h3></div>';
}

export function start() {
  addEventListener('hashchange', () => render());
  $('#tabbar').addEventListener('click', (e) => {
    const a = e.target.closest('.tab');
    if (!a) return;
    e.preventDefault();
    const t = a.dataset.tab;
    if (t === currentTab) {
      // Tap on the active tab: pop to root, or scroll to top if already there.
      if (currentPath === tabRoot(t)) scrollTo({ top: 0, behavior: 'smooth' });
      else go(tabRoot(t));
    } else {
      if (currentPath) scrolls.set(currentPath, scrollY);
      go(tabLast[t]);
    }
  });
  render();
}
