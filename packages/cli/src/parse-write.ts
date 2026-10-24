import { mintNodeId, parseDocument } from 'foundation-engine'

/** Reading stays deterministic; authoring new source nodes must be replica-safe. */
export function parseForWrite(source: string): ReturnType<typeof parseDocument> {
  return parseDocument(source, { mintNodeId })
}
