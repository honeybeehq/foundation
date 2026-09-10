import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { HostClient } from './host-client.js'
import { isDocument, record } from './contract.js'
import { options, startBundledHost, type RunningHost } from './runtime.js'

const args = options(process.argv)
const replicaDirectory = path.resolve(args.get('replica-dir') ?? path.join(app.getPath('userData'), 'replicas/default'))
app.setPath('userData', path.join(replicaDirectory, '.desktop'))
app.setName('Foundation')
let host: RunningHost | undefined
let client: HostClient | undefined
let closing = false
const requests = new Set<Promise<unknown>>()
process.once('exit', () => host?.process.kill())

function shutdown(): void {
  if (closing) return
  closing = true
  void Promise.allSettled([...requests]).then(() => client?.close()).catch(() => undefined).finally(() => { host?.process.kill(); app.quit() })
}

async function identity(): Promise<string> {
  const file = path.join(app.getPath('userData'), 'document.json')
  await mkdir(app.getPath('userData'), { recursive: true })
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!record(value) || typeof value.docId !== 'string') throw new Error('Invalid desktop document identity')
    if (args.has('doc-id') && args.get('doc-id') !== value.docId) throw new Error('Replica directory is already assigned to another document')
    return value.docId
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    const docId = args.get('doc-id') ?? randomUUID()
    await writeFile(file, JSON.stringify({ docId }), { flag: 'wx', mode: 0o600 })
    return docId
  }
}

async function launch(): Promise<void> {
  const docId = await identity()
  let url = args.get('host-url')
  let tokenFile = args.get('host-token-file')
  if (!url) {
    host = await startBundledHost(args.get('runtime-dir') ?? path.join(process.resourcesPath, 'host'), path.join(app.getPath('userData'), 'host'), args.get('comb-dir'))
    url = host.url; tokenFile = host.tokenFile
  }
  const token = tokenFile ? (await readFile(tokenFile, 'utf8')).trim() : process.env.FOUNDATION_HOST_TOKEN
  if (!token) throw new Error('Provide FOUNDATION_HOST_TOKEN or --host-token-file when connecting to an external host')
  const seed: unknown = JSON.parse(await readFile(path.join(__dirname, 'seed.json'), 'utf8'))
  if (!isDocument(seed)) throw new Error('Bundled seed document is invalid')
  client = new HostClient({ url, token, directory: replicaDirectory, docId, author: args.get('author') ?? 'user:local', ...(args.has('recover') ? {} : { seed }) })
  const window = new BrowserWindow({ width: 1440, height: 940, minWidth: 480, minHeight: 480, title: 'Foundation', backgroundColor: '#171512', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false },
  })
  const rendererURL = pathToFileURL(path.join(__dirname, 'index.html')).href
  const guard = (event: IpcMainInvokeEvent) => {
    if (closing || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url.split('?')[0] !== rendererURL) throw new Error('Unauthorized desktop request')
  }
  function handle(channel: string, action: (...values: unknown[]) => Promise<unknown>) {
    ipcMain.handle(channel, (event, ...values: unknown[]) => {
      guard(event)
      const request = action(...values)
      requests.add(request)
      void request.finally(() => requests.delete(request)).catch(() => undefined)
      return request
    })
  }
  handle('foundation:open', () => client!.open())
  handle('foundation:state', () => client!.state())
  handle('foundation:commit', async (ops, message) => {
    if (!Array.isArray(ops) || ops.length > 1000 || !ops.every(op => record(op) && typeof op.op === 'string') || typeof message !== 'string') throw new Error('Invalid edit request')
    return client!.commit(ops, message)
  })
  handle('foundation:annotate', async input => {
    if (!record(input) || typeof input.text !== 'string' || input.text.length > 20_000 || (input.nodeId !== undefined && typeof input.nodeId !== 'string')) throw new Error('Invalid comment')
    return client!.annotate({ text: input.text, ...(typeof input.nodeId === 'string' ? { nodeId: input.nodeId } : {}) })
  })
  handle('foundation:connection', async action => {
    if (action !== 'connect' && action !== 'disconnect' && action !== 'sync') throw new Error('Invalid connection action')
    return client!.connection(action)
  })
  handle('foundation:export', async () => {
    const destination = await dialog.showSaveDialog(window, {
      title: 'Export Foundation document', buttonLabel: 'Export', nameFieldLabel: 'Export folder name:',
      message: 'Choose a new folder name. Foundation creates it for the HTML and chain files; existing destinations are never overwritten.',
      defaultPath: path.join(app.getPath('documents'), 'Somewhere-export'), properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    const directory = destination.filePath
    return destination.canceled || !directory ? { canceled: true } : { canceled: false, files: await client!.export(directory) }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-prevent-unload', event => {
    const answer = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['Keep editing', 'Close'], defaultId: 0, cancelId: 0, message: 'Some edits have not been confirmed by the local host.', detail: 'Closing now may discard edits that were not saved.' })
    if (answer === 1) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  await window.loadFile(path.join(__dirname, 'index.html'), { query: { panels: 'docked', scheme: 'dark', accent: 'honey', shade: '30', canvas: '21' } })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus())
  app.whenReady().then(launch).catch(error => { dialog.showErrorBox('Foundation could not start', error instanceof Error ? error.message : String(error)); app.quit() })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => {
    if (closing) return
    event.preventDefault()
    // Let the window's beforeunload protect unconfirmed edits before closing the host.
    const window = BrowserWindow.getAllWindows()[0]
    // window-all-closed is not guaranteed during app.quit(). Continue explicitly
    // after the window accepts beforeunload; canceling close keeps the host alive.
    if (window && !window.isDestroyed()) { window.once('closed', shutdown); window.close(); return }
    shutdown()
  })
}
