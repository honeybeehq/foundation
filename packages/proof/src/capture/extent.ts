import type { Page } from 'playwright';
import {writeFile} from 'node:fs/promises';
/** Diagnostic only: reveal clipped paint without resizing/reflowing the component.
 * The normal screenshot and measured DOM remain untouched. */
export async function captureFullExtent(page: Page, root: string, path: string) {
  const bounds = await page.evaluate(root => {
    const el = document.querySelector(root)!;
    const r = el.getBoundingClientRect();
    const boxes = [el, ...el.querySelectorAll('*')].map(e => e.getBoundingClientRect());
    return {x: Math.max(0, Math.min(r.x, ...boxes.map(b => b.x))), y: Math.max(0, Math.min(r.y, ...boxes.map(b => b.y))),
      right: Math.max(r.right, r.x + el.scrollWidth, ...boxes.map(b => b.right)), bottom: Math.max(r.bottom, r.y + el.scrollHeight, ...boxes.map(b => b.bottom))};
  }, root);
  const style = await page.addStyleTag({content: `${root},${root} *{overflow:visible!important;clip-path:none!important}`});
  try {
    const cdp = await page.context().newCDPSession(page);
    try {
      const {data} = await cdp.send('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,fromSurface:true,
        clip:{x:bounds.x,y:bounds.y,width:Math.ceil(bounds.right-bounds.x),height:Math.ceil(bounds.bottom-bounds.y),scale:1}});
      await writeFile(path, Buffer.from(data,'base64'));
    } finally { await cdp.detach(); }
  } finally { await style.evaluate(el => el.parentNode?.removeChild(el)); }
}
