import type {LayoutRegionLink} from "./layout-regions.js"
export interface StateLink {
  layoutOnly?: {regions: LayoutRegionLink[]}
  name: string
  fixture: string
  designState: string
  designNode?: string
  provable?: boolean
  reason?: string
}

export interface ArtboardLink {
  layoutOnly?: {regions: LayoutRegionLink[]}
  id: string
  component: string
  designNode: string
  viewport: { width: number; height: number; dpr: number }
  states: StateLink[]
  components: { designComponent: string; code: string; selector: string }[]
}

export interface Links {
  schema: 'fdn-links/0'
  designFile: string
  designHead?: string
  binding?: 'chain-head' | 'chain-sha256'
  viteConfig: string
  harness: string
  fonts?: { family: string; weight: string; path: string; format?: string; sha256?: string; postScriptName?: string }[]
  fontPolicy?: {sans: string; mono: string; serif: string; fallback: string; requireCustomFonts: boolean}
  browserVersion?: string
  platform?: string
  artboards: ArtboardLink[]
}
