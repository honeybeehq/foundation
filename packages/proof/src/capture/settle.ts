import type {Page} from 'playwright'

export async function settleRoot(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve,reject) => {
    let previous = ''
    let stable = 0
    let frames = 0
    const check = () => {
      const current = document.querySelector('#foundation-root')!.innerHTML
      stable = current === previous && (window as any).__foundationPendingTimers === 0 ? stable + 1 : 0
      previous = current
      if (stable >= 3) resolve()
      else if (++frames >= 180) reject(new Error('Capture root did not settle within180 frames'))
      else requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }))
}
