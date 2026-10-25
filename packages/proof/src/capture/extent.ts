import type { Page } from 'playwright';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
/** Diagnostic paint with overflow revealed; it may reflow content.
 * Always run after the normal screenshot and measured DOM. */
export async function captureFullExtent(page: Page, root: string, path: string) {
  const bounds = await page.evaluate(root => {
    const el = document.querySelector(root)!;
    const r = el.getBoundingClientRect();
    const elements = [el, ...el.querySelectorAll('*')];
    const boxes = elements.map(e => e.getBoundingClientRect());
    const scrolls = elements.flatMap((e,i) => e.scrollLeft || e.scrollTop ? [{i,x:e.scrollLeft,y:e.scrollTop}] : []);
    return {scrolls,windowScroll:{x:scrollX,y:scrollY},x: Math.min(r.x, ...boxes.map(b => b.x)), y: Math.min(r.y, ...boxes.map(b => b.y)),
      right: Math.max(r.right, r.x + el.scrollWidth, ...boxes.map(b => b.right)), bottom: Math.max(r.bottom, r.y + el.scrollHeight, ...boxes.map(b => b.bottom))};
  }, root);
  const style = await page.addStyleTag({content: `${root},${root} *{overflow:visible!important;clip-path:none!important} html{translate:${-bounds.x}px ${-bounds.y}px!important}`});
  try {
    const cdp = await page.context().newCDPSession(page);
    try {
      const {data} = await cdp.send('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,fromSurface:true,
        clip:{x:0,y:0,width:Math.ceil(bounds.right-bounds.x),height:Math.ceil(bounds.bottom-bounds.y),scale:1}});
      const bytes = Buffer.from(data,'base64');
      await writeFile(path, bytes);
      return {file:'full-extent.png',sha256:createHash('sha256').update(bytes).digest('hex'),diagnosticPaint:true};
    } finally { await cdp.detach(); }
  } finally {
    await style.evaluate(el => el.parentNode?.removeChild(el));
    await page.evaluate(({root,scrolls,windowScroll}) => {
      const el = document.querySelector(root)!;
      const elements = [el,...el.querySelectorAll('*')];
      for(const s of scrolls) { elements[s.i]!.scrollLeft=s.x; elements[s.i]!.scrollTop=s.y; }
      window.scrollTo(windowScroll.x,windowScroll.y);
    },{root,scrolls:bounds.scrolls,windowScroll:bounds.windowScroll});
  }
}
