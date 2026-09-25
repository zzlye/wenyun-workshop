// 使用独立浏览器数据验证手机布局，只写测试账号的本地记录，不请求生成接口。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = process.env.MOBILE_TEST_URL || 'http://127.0.0.1:5173'
const out = process.env.MOBILE_ARTIFACT_DIR
if (!out) throw new Error('请设置 MOBILE_ARTIFACT_DIR 保存验收截图和记录')
fs.mkdirSync(out, { recursive: true })

async function seed(page) {
  await page.evaluate(async () => {
    const { putImage, putTask } = await import('/src/lib/db.ts')
    const { DEFAULT_PARAMS } = await import('/src/types.ts')
    const blob = await (await fetch('/assets/home-streamer-d482b116.webp')).blob()
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
    await putImage({ id: 'mobile-fixture', dataUrl, width: 2560, height: 1440, source: 'upload' })
    for (let index = 0; index < 6; index++) {
      await putTask({ id: `mobile-${index}`, prompt: `手机端作品 ${index}，山林与光影。` + 'long-prompt-without-spaces-'.repeat(12), params: { ...DEFAULT_PARAMS }, inputImageIds: [], outputImages: ['mobile-fixture'], status: 'done', error: null, createdAt: 10000 - index, finishedAt: 20000, elapsed: 10000, apiProfileName: '文运站', apiModel: 'gpt-image-2.5-sunburst-满血' })
    }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.task-card-wrapper').first().waitFor()
}

async function inViewport(locator, page, name) {
  const rect = await locator.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, `${name}越界：${JSON.stringify(rect)}`)
}

async function run() {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
  const results = []
  try {
    for (const [width, height] of [[320, 568], [360, 740], [390, 844], [430, 932], [667, 375], [844, 390], [768, 1024], [1440, 900]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 950, hasTouch: width < 950, deviceScaleFactor: 1 })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== base) return route.abort()
        if (/^\/(wy-public|api-proxy|newapi-proxy|model-)/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":[]}' })
        return route.continue()
      })
      await page.addInitScript(() => {
        if (!localStorage.getItem('gpt-image-playground')) localStorage.setItem('gpt-image-playground', JSON.stringify({ version: 2, state: { settings: { homeStreamerMode: true }, supportPromptDismissed: true, supportPromptSkippedForImportedData: true } }))
      })
      await page.goto(`${base}/wenyun`, { waitUntil: 'networkidle' })
      await page.locator('[data-input-bar]').waitFor()
      await seed(page)
      const metrics = await page.evaluate(() => {
        const rect = document.querySelector('[data-input-bar]').getBoundingClientRect()
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, titleHeight: document.querySelector('header h1').getBoundingClientRect().height, barHeight: rect.height, padding: parseFloat(getComputedStyle(document.querySelector('[data-home-main]')).paddingBottom), promptFont: parseFloat(getComputedStyle(document.querySelector('[contenteditable]')).fontSize) }
      })
      assert.equal(metrics.scrollWidth, metrics.width, '页面横向溢出')
      assert.ok(metrics.titleHeight < 36, '顶部标题折行')
      assert.ok(metrics.padding >= metrics.barHeight, '列表末尾被输入区遮挡')
      await inViewport(page.locator('[data-input-bar]'), page, '输入区')
      assert.ok(await page.locator('[data-task-actions]').first().evaluate((element) => {
        const container = element.getBoundingClientRect()
        return [...element.querySelectorAll('button')].every((button) => {
          const rect = button.getBoundingClientRect()
          return rect.left >= container.left - 1 && rect.right <= container.right + 1
        })
      }), '作品操作按钮被裁切')
      if (width < 1280) {
        await page.getByRole('button', { name: '更多功能', exact: true }).click()
        const menu = page.getByRole('navigation', { name: '工坊更多功能' })
        await inViewport(menu, page, '更多菜单')
        for (const name of ['查询', '模型列表']) assert.ok(await menu.getByRole('button', { name, exact: true }).isVisible(), `更多菜单缺少${name}`)
        await page.getByRole('button', { name: '更多功能', exact: true }).click()
      }
      if (width < 640) {
        assert.ok(metrics.barHeight < 250, '手机输入区默认占用过大')
        assert.ok(metrics.promptFont >= 16, '手机编辑字号过小')
        await page.getByRole('button', { name: '更多功能', exact: true }).click()
        await inViewport(page.getByRole('navigation', { name: '工坊更多功能' }), page, '更多菜单')
        await page.getByRole('button', { name: '更多功能', exact: true }).click()
        await page.getByRole('button', { name: '展开生成参数', exact: true }).click()
        await page.getByRole('combobox', { name: '品质', exact: true }).selectOption('high')
        await page.getByRole('button', { name: '收起生成参数', exact: true }).waitFor()
        await page.screenshot({ path: path.join(out, `parameters-${width}.png`), animations: 'disabled' })
        await page.getByTitle('选择尺寸', { exact: true }).filter({ visible: true }).click()
        await inViewport(page.getByRole('dialog', { name: '设置图像尺寸' }), page, '尺寸选择')
        await page.getByRole('button', { name: '取消', exact: true }).click()
        await page.getByRole('button', { name: '收起生成参数', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('#workshop-mobile-params').getBoundingClientRect().height < 1)
      }
      await page.screenshot({ path: path.join(out, `workshop-${width}.png`) })
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForFunction(() => {
        const cards = document.querySelectorAll('.task-card-wrapper')
        return cards[cards.length - 1].getBoundingClientRect().bottom <= document.querySelector('[data-input-bar]').getBoundingClientRect().top
      })
      await page.evaluate(() => scrollTo(0, 0))
      await page.locator('.task-card-wrapper').first().click()
      const detail = page.getByRole('dialog', { name: '图片详情' })
      await inViewport(detail, page, '图片详情')
      for (const name of ['复用配置', '编辑输出', '删除记录']) await inViewport(detail.getByRole('button', { name, exact: true }), page, name)
      assert.ok(await detail.getByRole('button', { name: '复用配置', exact: true }).evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }), '详情操作被其他浮层遮挡')
      assert.ok(await page.locator('[data-workshop-announcement]').evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return !element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }), '公告覆盖详情弹窗')
      await page.screenshot({ path: path.join(out, `detail-${width}.png`) })
      await detail.getByRole('button', { name: '关闭', exact: true }).filter({ visible: true }).click()
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await inViewport(page.locator('[data-settings-dialog]'), page, '设置弹窗')
      await page.getByRole('button', { name: '关闭', exact: true }).filter({ visible: true }).click()
      if (width === 320) {
        await page.getByRole('button', { name: '放大编辑框', exact: true }).click()
        await inViewport(page.locator('[data-composer-card]'), page, '放大编辑框')
        await page.getByRole('button', { name: '还原编辑框', exact: true }).click()
        await page.locator('input[type="file"][multiple]').first().setInputFiles(path.join(__dirname, '../public/assets/home-streamer-d482b116.webp'))
        await page.getByText('1 张参考图', { exact: true }).waitFor()
        await page.getByRole('button', { name: '展开生成参数', exact: true }).click()
        await page.getByRole('combobox', { name: '模型', exact: true }).waitFor()
        await inViewport(page.locator('[data-composer-card]'), page, '带参考图的参数区')
        await page.screenshot({ path: path.join(out, 'reference-320.png'), animations: 'disabled' })
        await page.getByRole('button', { name: '收起生成参数', exact: true }).click()
        await page.evaluate(() => {
          const saved = JSON.parse(localStorage.getItem('gpt-image-playground'))
          saved.state.settings.newApiAccountSessions = { 'wenyun-site': { siteProfileId: 'wenyun-site', username: '这是很长的文运账号名称', accessToken: 'mobile-test-token' } }
          localStorage.setItem('gpt-image-playground', JSON.stringify(saved))
        })
        await page.reload({ waitUntil: 'networkidle' })
        await page.getByRole('button', { name: '账号', exact: true }).waitFor()
        assert.ok(await page.locator('header').evaluate((element) => element.querySelector('h1').getBoundingClientRect().right <= element.querySelector('.workshop-account-button').getBoundingClientRect().left), '长账号挤压标题')
        await inViewport(page.getByRole('button', { name: '设置', exact: true }), page, '长账号下的设置入口')
      }
      if (width === 390) {
        await page.locator('[contenteditable]').fill('手机输入与软键盘布局测试'.repeat(25))
        // 模拟 iOS 只缩小可视区域并向上平移；不把模拟当作真机键盘验收。
        await page.evaluate(() => {
          Object.defineProperty(visualViewport, 'height', { configurable: true, value: 390 })
          Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 60 })
          visualViewport.dispatchEvent(new Event('resize'))
        })
        await page.waitForFunction(() => document.querySelector('[data-input-bar]').getBoundingClientRect().bottom <= 450)
        await page.screenshot({ path: path.join(out, 'keyboard-simulated.png') })
        await page.evaluate(() => { delete visualViewport.height; delete visualViewport.offsetTop; visualViewport.dispatchEvent(new Event('resize')) })
        await page.getByRole('button', { name: '更多功能', exact: true }).click()
        await page.getByRole('button', { name: '切换到夜间模式', exact: true }).filter({ visible: true }).click()
        await page.screenshot({ path: path.join(out, 'workshop-dark.png') })
      }
      assert.deepEqual(errors, [], '浏览器存在运行错误')
      results.push({ width, height, ...metrics, status: 'PASS' })
      console.log(`VIEWPORT=${width}x${height} PASS`)
      await context.close()
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
    console.log('MOBILE_LAYOUT=PASS VIEWPORTS=8')
  } finally { await browser.close() }
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
