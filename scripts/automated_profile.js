const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')

async function tryClickByXPath(page, xpath, desc) {
  // Use in-page XPath evaluation to click elements to avoid relying on page helper shims
  try {
    const clicked = await page.evaluate((xp) => {
      try {
        const res = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
        const el = res.singleNodeValue
        if (el && typeof el.click === 'function') {
          el.click()
          return true
        }
        return false
      } catch (e) {
        return false
      }
    }, xpath)
    if (clicked) console.log(`Clicked ${desc}`)
    else console.log(`Element not found: ${desc} (xpath: ${xpath})`)
    await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 600)
    return clicked
  } catch (err) {
    console.error(`Error clicking ${desc}:`, err && err.message ? err.message : err)
    return false
  }
}

async function waitForXPath(page, xpath, timeoutMs = 10000, poll = 200) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate((xp) => {
      try {
        const res = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
        return !!res.singleNodeValue
      } catch (e) {
        return false
      }
    }, xpath)
    if (found) return true
    await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), poll)
  }
  return false
}

async function run() {
  const tracesDir = path.resolve(__dirname, '..', 'traces')
  if (!fs.existsSync(tracesDir)) fs.mkdirSync(tracesDir, { recursive: true })

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })

  const targets = [
    {
      name: 'dashboard',
      url: 'http://localhost:3000/dashboard',
      actions: async (page) => {
        await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 500)
        await waitForXPath(page, "//h2[contains(., 'Cumulative P&L')]", 10000).catch(() => {})
        for (const y of [200, 600, 0]) {
          await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), y)
          await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 700)
        }
        await tryClickByXPath(page, "//h2[contains(., 'Cumulative P&L')]", 'Cumulative P&L header')
      }
    },
    {
      name: 'strategy-engine',
      url: 'http://localhost:3000/dashboard/strategy-engine',
      actions: async (page) => {
        const markets = ['Crypto', 'Indian', 'Forex', 'Commodities']
        for (const m of markets) {
          const xpath = `//span[text() = '${m}']/ancestor::button[1]`
          const clicked = await tryClickByXPath(page, xpath, `market header ${m}`)
          if (clicked) {
            // try toggles inside expanded section
            await tryClickByXPath(page, "//button[normalize-space()='AGGRESSIVE']", `AGGRESSIVE toggle for ${m}`)
            await tryClickByXPath(page, "//button[normalize-space()='SAFE']", `SAFE toggle for ${m}`)
          }
        }
      }
    },
    {
      name: 'trades',
      url: 'http://localhost:3000/dashboard/trades',
      actions: async (page) => {
        await waitForXPath(page, "//h1[contains(., 'Trade History')]", 10000).catch(() => {})
        for (const pill of ['crypto', 'indian']) {
          await tryClickByXPath(page, `//button[normalize-space() = '${pill}']`, `filter pill ${pill}`)
        }
        await tryClickByXPath(page, "//button[normalize-space() = '2']", 'pagination page 2')
        try {
          const hovered = await page.evaluate(() => {
            try {
              const res = document.evaluate("//button[.//svg[contains(@class,'ChevronRight')]]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
              const el = res.singleNodeValue
              if (!el) return false
              el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
              return true
            } catch (e) {
              return false
            }
          })
          if (hovered) { console.log('Hovered next button'); await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 600) }
        } catch (e) { console.log('No next button hoverable') }
      }
    }
  ]

  for (const t of targets) {
    const tracePath = path.join(tracesDir, `${t.name}-trace.json`)
    console.log(`Starting trace for ${t.name} -> ${tracePath}`)
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.tracing.start({ path: tracePath, screenshots: false, categories: ['devtools.timeline', 'v8', 'blink.user_timing'] })
    await page.goto(t.url, { waitUntil: 'networkidle2', timeout: 120000 }).catch(err => { console.error('Navigation failed', err && err.message ? err.message : err) })
    try {
      // run the target actions but replace direct time waits with in-page sleeps
      await t.actions(page)
      await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 1500)
    } catch (err) {
      console.error(`Error during actions for ${t.name}:`, err && err.message ? err.message : err)
    }
    await page.tracing.stop()
    await page.close()
    console.log(`Saved trace for ${t.name}`)
  }

  await browser.close()
  console.log('All traces saved to', tracesDir)
}

run().catch(err => { console.error(err); process.exit(1) })
