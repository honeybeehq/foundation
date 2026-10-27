export function captureFrames(reference: {width:number;height:number}, viewport: {width:number;height:number}, preserveContext: boolean) {
  return {frame:reference, hostFrame:preserveContext ? {width:viewport.width,height:viewport.height} : reference}
}
