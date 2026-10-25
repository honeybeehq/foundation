export interface StateLink {
  name: string
  fixture: string
  designState: string
  designNode?: string
}

export interface ArtboardLink {
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
  viteConfig: string
  harness: string
  fonts?: { family: string; weight: string; path: string }[]
  artboards: ArtboardLink[]
}
