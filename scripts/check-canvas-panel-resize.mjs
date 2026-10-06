// 使用真实节点、四角拖拽和提示词面板测量布局；独立浏览器数据不调用生成接口。
// 运行前启动本地页面，并设置 CANVAS_TEST_URL、CANVAS_ARTIFACT_DIR 和 PLAYWRIGHT_MODULE。
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.CANVAS_TEST_URL || 'http://127.0.0.1:5173';
const output = process.env.CANVAS_ARTIFACT_DIR;
if (!output) throw new Error('请设置 CANVAS_ARTIFACT_DIR 保存检查记录');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/panel-resize-check') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="UTF-8"></head><body style="margin:0"><div id="fixture" style="width:100vw;height:100vh"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script></body></html>' });
    if (/^\/(src\/|node_modules\/|@|assets\/)/.test(url.pathname)) return route.continue();
    return route.fulfill({ contentType: 'application/json', body: '{"success":true,"data":[]}' });
  });
  await page.goto(base + '/panel-resize-check');
  await page.evaluate(async () => {
    await import('/src/index.css');
    // 复用 Vite 给真实组件解析出的依赖地址，避免查询参数不同导致上下文出现双实例。
    const source = await (await fetch('/src/infiniteCanvasSource/components/layout/app-providers.tsx')).text();
    const dep = name => source.match(new RegExp('"([^" ]*/' + name + '\\.js[^" ]*)"'))?.[1];
    const reactSource = await (await fetch('/src/main.tsx')).text();
    const reactDomUrl = reactSource.match(/"([^" ]*react-dom_client\.js[^" ]*)"/)?.[1];
    const { default: React } = await import(dep('react'));
    const { default: ReactDOM } = await import(reactDomUrl);
    const { QueryClient, QueryClientProvider } = await import(dep('@tanstack_react-query'));
    const { InfiniteCanvas } = await import('/src/infiniteCanvasSource/app/(user)/canvas/components/infinite-canvas.tsx');
    const { CanvasNode } = await import('/src/infiniteCanvasSource/app/(user)/canvas/components/canvas-node.tsx');
    const { CanvasNodePromptPanel } = await import('/src/infiniteCanvasSource/app/(user)/canvas/components/canvas-node-prompt-panel.tsx');
    const { useThemeStore } = await import('/src/infiniteCanvasSource/stores/use-theme-store.ts');
    const noop = () => {};
    function Fixture() {
      const ref = React.useRef(null);
      const [node, setNode] = React.useState(null);
      const [viewport, setViewport] = React.useState({ x: 0, y: 0, k: 1 });
      window.resetNode = ({ type = 'image', width = 720, scale = 0.5, theme = 'light' } = {}) => {
        useThemeStore.getState().setTheme(theme);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        window.resizeCommits = 0;
        setNode({ id: 'resize-test', title: '节点尺寸检查', type, position: { x: Math.min(220, (window.innerWidth - width * scale) / 2) / scale, y: 160 / scale }, width, height: width * 9 / 16, metadata: { content: type === 'image' ? '/assets/home-streamer-d482b116.webp' : '', naturalWidth: 1600, naturalHeight: 900, prompt: '保留提示词，拖动节点四角检查下面的控制面板是否实时跟随。' } });
        setViewport({ x: 0, y: 0, k: scale });
      };
      return React.createElement(InfiniteCanvas, { containerRef: ref, viewport, onViewportChange: setViewport }, node && React.createElement(CanvasNode, {
        data: node, scale: viewport.k, isSelected: true, isRelated: false, isFocusRelated: false, isConnectionTarget: false, isConnecting: false, showPanel: true, showImageInfo: false,
        onMouseDown: noop, onHoverStart: noop, onHoverEnd: noop, onConnectStart: noop, onContentChange: noop, onContextMenu: noop,
        onResize: (_, width, height, position) => { window.resizeCommits++; setNode(previous => ({ ...previous, width, height, position })); },
        renderPanel: data => React.createElement(CanvasNodePromptPanel, { node: data, canvasNodes: [data], isRunning: false, onPromptChange: (_, prompt) => setNode(previous => ({ ...previous, metadata: { ...previous.metadata, prompt } })), onConfigChange: noop, onGenerate: noop }),
      }));
    }
    ReactDOM.createRoot(document.querySelector('#fixture')).render(React.createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, React.createElement(Fixture)));
  });
  await page.waitForFunction(() => typeof window.resetNode === 'function');
  const node = page.locator('[data-node-id="resize-test"]');
  const panel = node.locator('[data-canvas-editor]').first();
  const metrics = () => page.evaluate(() => {
    const node = document.querySelector('[data-node-id="resize-test"]');
    const panel = node.querySelector('[data-canvas-editor]');
    const a = node.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    return { nodeWidth: a.width, panelWidth: b.width, centerDelta: b.x + b.width / 2 - a.x - a.width / 2, gap: b.top - a.bottom, commits: window.resizeCommits };
  });
  const aligned = (value, label) => {
    assert.ok(Math.abs(value.nodeWidth - value.panelWidth) < 1, `${label} 节点宽 ${value.nodeWidth}，面板宽 ${value.panelWidth}`);
    assert.ok(Math.abs(value.centerDelta) < 1, `${label} 面板没有居中`);
    assert.ok(value.gap >= 0 && value.gap < 20, `${label} 面板没有贴在节点下方`);
  };
  for (const type of ['image', 'video', 'text']) {
    for (const scale of [0.5, 1]) {
      for (const corner of type === 'image' ? ['top-left', 'top-right', 'bottom-left', 'bottom-right'] : ['bottom-right']) {
        await page.evaluate(options => window.resetNode(options), { type, scale, theme: scale === 1 ? 'dark' : 'light' });
        await panel.waitFor();
        await page.waitForFunction(() => window.resizeCommits === 0);
        const index = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].indexOf(corner);
        const handle = node.locator('[class*="cursor-"][class*="resize"]').nth(index);
        const box = await handle.boundingBox();
        assert.ok(box);
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const dx = (corner.endsWith('left') ? -1 : 1) * 160;
        const dy = (corner.startsWith('top') ? -1 : 1) * 90;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 6 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const during = await metrics();
        results.push({ type, scale, corner, during });
        aligned(during, `${type}/${scale}/${corner} 拖动中`);
        assert.equal(during.commits, 0, '拖动中不应反复保存节点');
        await page.mouse.up();
        await page.waitForFunction(() => window.resizeCommits === 1);
        aligned(await metrics(), '松手后');
        // 在同一次真实拖拽中缩回原尺寸，避免只覆盖单向放大。
        const endBox = await handle.boundingBox();
        const ex = endBox.x + endBox.width / 2;
        const ey = endBox.y + endBox.height / 2;
        await page.mouse.move(ex, ey);
        await page.mouse.down();
        await page.mouse.move(ex - dx, ey - dy, { steps: 6 });
        await page.mouse.up();
        await page.waitForFunction(() => window.resizeCommits === 2);
        aligned(await metrics(), '缩小后');
      }
    }
  }
  // 节点世界坐标宽度超过窗口时，缩小画布仍应保持面板与节点同宽，不能误用窗口宽度截断。
  await page.evaluate(() => window.resetNode({ width: 2400, scale: 0.5 }));
  await page.waitForFunction(() => document.querySelector('[data-node-id="resize-test"]').style.width === '2400px');
  aligned(await metrics(), '大节点缩放画布后');
  await page.mouse.move(1500, 80);
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(() => document.querySelector('[data-node-id="resize-test"]').getBoundingClientRect().width < 1200);
  aligned(await metrics(), '滚轮缩放画布后');
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-node-id="resize-test"] img');
    return image?.complete && image.naturalWidth > 0;
  });
  await page.screenshot({ path: path.join(output, 'desktop.png') });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => window.resetNode({ width: 240, scale: 1 }));
  await panel.waitFor();
  assert.ok((await panel.boundingBox()).width <= 366, '小节点的控制面板超出窄屏可用宽度');
  await panel.getByRole('button', { name: '放大编辑框' }).click();
  const expanded = page.locator('[data-canvas-editor].fixed');
  await expanded.waitFor();
  assert.ok((await expanded.boundingBox()).width <= 358, '展开输入框超出窄屏');
  await page.screenshot({ path: path.join(output, 'mobile-expanded.png') });
  assert.deepEqual(errors, []);
  console.log(`PASS: ${results.length} resize cases; live alignment; one commit per drag; narrow screen; no page errors`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}
