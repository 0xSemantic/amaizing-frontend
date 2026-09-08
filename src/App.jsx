import { useEffect, useRef, useState } from 'react'

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

// Phone cameras produce large photos, so the ceiling is generous and only guards
// against obviously unusable uploads. Keep it in step with AMAIZING_MAX_UPLOAD_MB.
const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB) > 0
  ? Number(import.meta.env.VITE_MAX_UPLOAD_MB)
  : 500
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

// The model works from a 224px crop, so a long edge of 1600px keeps every detail
// that affects the diagnosis while cutting a 12 MB phone photo to a few hundred KB.
const MAX_IMAGE_EDGE = 1600
const RECOMPRESS_ABOVE_BYTES = 2 * 1024 * 1024
const JPEG_QUALITY = 0.85

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // Applies the EXIF rotation phones record instead of baking in a sideways leaf.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      return await createImageBitmap(file)
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The image could not be decoded.')) }
    image.src = url
  })
}

// Shrinks oversized camera photos before upload. Returns the original file whenever
// resizing would not help, so a small hand-picked image is sent through untouched.
async function shrinkImage(source, file) {
  const width = source.width || source.naturalWidth
  const height = source.height || source.naturalHeight
  if (!width || !height) return file
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height))
  if (scale === 1 && file.size <= RECOMPRESS_ABOVE_BYTES) return file
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob || blob.size >= file.size) return file
  const stem = file.name.replace(/\.[^.]+$/, '') || 'leaf'
  return new File([blob], `${stem}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}

// The model has only four outputs (Blight, Common Rust, Gray Leaf Spot, Healthy) and no
// "not a leaf" class, so it labels a photo of anything at all as one of the four. This
// gate catches the obviously wrong subjects before a request is spent on them.
//
// Every bound below is calibrated against 4,940 real maize leaf images: the lab splits
// in dataset/ plus the PlantDoc field photos. Together they trip these rules on 1 image
// (0.02%), so the checks reject subjects, not diseased tissue. Deliberately they test
// for what a leaf is never made of rather than for green, because blighted leaves are
// tan, rust is orange-brown and gray leaf spot is grey. Anything a farmer might really
// photograph is let through; the warning it raises is advisory and can be overridden.
const GATE_EDGE = 256
const GATE = {
  darkValue: 0.10,      // real leaves never fall below a mean value of 0.15
  foliageFloor: 0.12,   // first percentile across real leaves is 0.27
  skyShare: 0.55,       // highest measured on a real leaf photo is 0.44
  skyFoliage: 0.25,
  neutralShare: 0.80,   // highest measured on a real leaf photo is 0.76
  flatGradient: 0.010,  // no real leaf combines this with flatColours below
  flatColours: 0.90,
  textGradient: 0.006,  // separates document and UI edges from a blank surface
}

function imageSignals(source) {
  const width = source.width || source.naturalWidth
  const height = source.height || source.naturalHeight
  const scale = Math.min(1, GATE_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  const columns = Math.max(1, Math.round(width * scale))
  const rows = Math.max(1, Math.round(height * scale))
  canvas.width = columns
  canvas.height = rows
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(source, 0, 0, columns, rows)
  const { data } = context.getImageData(0, 0, columns, rows)
  const total = columns * rows

  const buckets = new Int32Array(4096)
  const luma = new Float32Array(total)
  let foliage = 0
  let sky = 0
  let neutral = 0
  let valueSum = 0

  for (let pixel = 0; pixel < total; pixel++) {
    const i = pixel * 4
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const max = Math.max(r, g, b)
    const chroma = max - Math.min(r, g, b)
    const saturation = max > 0 ? chroma / max : 0
    valueSum += max
    if (saturation < 0.12) neutral++
    if (chroma > 1e-6) {
      let hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
      hue *= 60
      if (hue < 0) hue += 360
      // 15deg to 170deg spans rust orange and blight tan through to healthy green.
      if (saturation >= 0.15 && hue >= 15 && hue <= 170) foliage++
      if (saturation >= 0.18 && hue >= 185 && hue <= 265) sky++
    }
    buckets[((r * 15) << 8 | (g * 15) << 4 | (b * 15)) & 0xfff]++
    luma[pixel] = 0.299 * r + 0.587 * g + 0.114 * b
  }

  let acrossSum = 0
  let acrossCount = 0
  for (let y = 0; y < rows; y++) {
    for (let x = 1; x < columns; x++) {
      acrossSum += Math.abs(luma[y * columns + x] - luma[y * columns + x - 1])
      acrossCount++
    }
  }
  let downSum = 0
  let downCount = 0
  for (let y = 1; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      downSum += Math.abs(luma[y * columns + x] - luma[(y - 1) * columns + x])
      downCount++
    }
  }

  const ranked = Array.from(buckets).sort((a, b) => b - a)
  let dominant = 0
  for (let i = 0; i < 8; i++) dominant += ranked[i]

  return {
    foliage: foliage / total,
    sky: sky / total,
    neutral: neutral / total,
    value: valueSum / total,
    colours: dominant / total,
    gradient: ((acrossCount ? acrossSum / acrossCount : 0) + (downCount ? downSum / downCount : 0)) / 2,
  }
}

// Returns an advisory message, or an empty string when the photo looks usable.
function inspectLeaf(source) {
  const signal = imageSignals(source)
  if (signal.value < GATE.darkValue) {
    return 'This photo is too dark to read. Try again in better light.'
  }
  if (signal.sky > GATE.skyShare && signal.foliage < GATE.skyFoliage) {
    return 'This looks like sky, water or a screen rather than a leaf.'
  }
  if (signal.gradient < GATE.flatGradient && signal.colours > GATE.flatColours) {
    return 'This looks blank or out of focus. Move closer to the leaf and try again.'
  }
  if (signal.neutral > GATE.neutralShare && signal.foliage < GATE.foliageFloor && signal.gradient > GATE.textGradient) {
    return 'This looks like a screenshot or a document rather than a photo of a leaf.'
  }
  if (signal.foliage < GATE.foliageFloor) {
    return 'This does not look like a maize leaf.'
  }
  return ''
}

function App() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches)
  })
  const [online, setOnline] = useState(null)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showInstall, setShowInstall] = useState(false)
  const [installed, setInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
  )
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [warning, setWarning] = useState('')
  const inputRef = useRef(null)
  // Tracks the live object URL so it is revoked exactly once, even across the await
  // in chooseFile and the double render StrictMode performs in development.
  const previewRef = useRef('')

  useEffect(() => {
    document.body.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    fetch(`${API_URL}/healthz`, { signal: controller.signal })
      .then(response => setOnline(response.ok))
      .catch(() => setOnline(false))
      .finally(() => clearTimeout(timer))
    return () => { clearTimeout(timer); controller.abort() }
  }, [])

  useEffect(() => {
    const onPrompt = event => {
      event.preventDefault()
      setInstallPrompt(event)
      if (!sessionStorage.getItem('install-prompt-dismissed')) setShowInstall(true)
    }
    const onInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
      setShowInstall(false)
    }
    const displayMode = window.matchMedia('(display-mode: standalone)')
    const onDisplayMode = event => setInstalled(event.matches)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    displayMode.addEventListener('change', onDisplayMode)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      displayMode.removeEventListener('change', onDisplayMode)
    }
  }, [])

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
  }, [])

  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(() => setMessage(''), 5000)
    return () => clearTimeout(timer)
  }, [message])

  useEffect(() => {
    const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent)
    if (installed || !isAppleMobile || sessionStorage.getItem('install-prompt-dismissed')) return undefined
    const timer = setTimeout(() => setShowInstall(true), 1800)
    return () => clearTimeout(timer)
  }, [installed])

  function showPreview(nextUrl) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = nextUrl
    setPreview(nextUrl)
  }

  async function chooseFile(nextFile) {
    if (!nextFile) return
    if (!['image/jpeg', 'image/png'].includes(nextFile.type)) {
      setMessage('Please choose a JPEG or PNG image.')
      return
    }
    if (nextFile.size > MAX_UPLOAD_BYTES) {
      setMessage(`The image must be ${MAX_UPLOAD_MB} MB or smaller.`)
      return
    }
    setPreparing(true)
    setWarning('')
    let ready = nextFile
    let verdict = ''
    let source = null
    try {
      source = await decodeImage(nextFile)
      verdict = inspectLeaf(source)
      ready = await shrinkImage(source, nextFile)
    } catch {
      // A browser that cannot decode the file still gets to upload the original,
      // unchecked. The gate is an aid, never a gate on the app working at all.
      ready = nextFile
      verdict = ''
    } finally {
      source?.close?.()
      setPreparing(false)
    }
    setFile(ready)
    setWarning(verdict)
    showPreview(URL.createObjectURL(ready))
    setResult(null)
  }

  function clearFile() {
    setFile(null)
    setWarning('')
    showPreview('')
    setResult(null)
  }

  async function analyze(event) {
    event.preventDefault()
    if (!file || warning) return
    setLoading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch(`${API_URL}/predict`, { method: 'POST', body })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'The analysis could not be completed.')
      setResult(data)
    } catch (error) {
      setMessage(error.message === 'Failed to fetch'
        ? 'Cannot reach the Amaizing API. Check the API URL and connection.'
        : error.message)
    } finally {
      setLoading(false)
    }
  }

  const mediaUrl = path => path?.startsWith('http') ? path : `${API_URL}${path}`
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)

  async function installApp() {
    if (!installPrompt) {
      setShowInstall(true)
      return
    }
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    setInstallPrompt(null)
    if (choice.outcome !== 'accepted') setShowInstall(true)
  }

  function dismissInstall() {
    sessionStorage.setItem('install-prompt-dismissed', 'true')
    setShowInstall(false)
  }

  return <>
    <header className="nav">
      <div className="nav-inner">
        <div className="brand-group">
          <a className="brand" href="#home">🌽 Amaizing</a>
          <span className="credit-badge">by Firstman Noah Otobo</span>
        </div>
        <div className="nav-actions">
          <span className={`connection ${online === true ? 'online' : online === false ? 'offline' : ''}`}>
            {online === true ? 'API online' : online === false ? 'API offline' : 'Checking API…'}
          </span>
          {!installed && <button className="install-nav-button" aria-label="Install Amaizing" title="Install Amaizing" onClick={installApp}><span>⇩</span><b>Install</b></button>}
          <button className="icon-button" aria-label="Toggle dark mode" title="Toggle dark mode" onClick={() => setDark(value => !value)}>◐</button>
          <a className="button button-small" href="#detector">Detect</a>
        </div>
      </div>
    </header>

    <main>
      <section id="home" className="hero">
        <div className="shell hero-grid">
          <div>
            <span className="eyebrow">AI-powered crop protection</span>
            <h1>Protect every maize leaf with <span>Amaizing</span> intelligence.</h1>
            <p className="lead">Upload or photograph a maize leaf and receive an explainable disease diagnosis from the trained ResNet50 model.</p>
            <div className="hero-actions"><a className="button" href="#detector">Launch Detector</a><a className="button button-ghost" href="#how-it-works">How It Works</a></div>
            <div className="feature-pills" aria-label="Key features"><span>96-97% accuracy</span><span>Grad-CAM</span><span>Mobile-ready</span></div>
            <p className="credit-line">Built, owned &amp; powered by <strong>Firstman Noah Otobo</strong></p>
          </div>
          <div className="hero-card" aria-hidden="true"><div className="leaf">🌿</div><div className="scan-line"></div><strong>Leaf analysis</strong><span>Explainable results in moments</span></div>
        </div>
      </section>

      <section id="detector" className="section detector-section">
        <div className="shell">
          <div className="section-heading"><span className="eyebrow">Field diagnosis</span><h2>Maize Disease Detector</h2><p>Take a clear photo or choose one from your device.</p></div>
          <div className="detector-grid">
            <section className="panel">
              <h3><span aria-hidden="true">📷</span> Provide Leaf Image</h3>
              <form onSubmit={analyze}>
                <input ref={inputRef} type="file" accept="image/jpeg,image/png" hidden onChange={event => { chooseFile(event.target.files[0]); event.target.value = '' }}/>
                {!preview && <button className="drop-zone" type="button" onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]) }}>
                  <span className="upload-icon">☁</span><strong>Tap to take or choose a photo</strong><small>JPEG or PNG, up to {MAX_UPLOAD_MB} MB. Large photos are resized on your phone before upload.</small>
                </button>}
                {preview && <div className="preview"><img src={preview} alt="Selected maize leaf preview"/><button className="clear-button" type="button" onClick={clearFile} aria-label="Remove selected image">×</button></div>}
                {warning && <div className="leaf-check" role="alert">
                  <strong>{warning}</strong>
                  <p>The model only knows four maize leaf conditions, so analyzing this would return a confident but meaningless result. If it really is a maize leaf, carry on.</p>
                  <div className="leaf-check-actions">
                    <button className="button button-small" type="button" onClick={() => inputRef.current?.click()}>Choose another photo</button>
                    <button className="button button-ghost button-small" type="button" onClick={() => setWarning('')}>Analyze anyway</button>
                  </div>
                </div>}
                <button className="button analyze-button" type="submit" disabled={!file || loading || preparing || !!warning}>{preparing ? <>Preparing photo… <span className="spinner"/></> : loading ? <>Analyzing… <span className="spinner"/></> : 'Analyze Image'}</button>
              </form>
            </section>
            <section className="panel result-panel" aria-live="polite">
              <h3><span aria-hidden="true">🩺</span> Diagnosis</h3>
              {!result ? <div className="placeholder"><span>🌽</span><p>Your diagnosis will appear here.</p></div> : <div>
                <div className="diagnosis"><h4>{result.predicted_class}</h4><p className="confidence">Confidence: <strong>{result.confidence}</strong></p></div>
                <div className="result-images">
                  <figure><figcaption>Original Leaf</figcaption><img src={mediaUrl(result.original_image_url)} alt="Uploaded maize leaf"/></figure>
                  <figure><figcaption>Model Focus (Grad-CAM)</figcaption><img src={mediaUrl(result.explained_image_url)} alt="Grad-CAM model focus"/></figure>
                </div>
                <p className="explanation">💡 {result.explanation_text}</p>
              </div>}
            </section>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="section muted-section"><div className="shell"><div className="section-heading"><span className="eyebrow">Simple by design</span><h2>How It Works</h2></div><div className="steps">
        <article><b>1</b><h3>Capture</h3><p>Photograph the affected maize leaf in clear light.</p></article>
        <article><b>2</b><h3>Analyze</h3><p>The API securely sends it through the trained model.</p></article>
        <article><b>3</b><h3>Understand</h3><p>Review the diagnosis, confidence and Grad-CAM focus.</p></article>
      </div></div></section>
      <section className="section"><div className="shell feature-grid">
        <article><span>◉</span><h3>Explainable AI</h3><p>Grad-CAM shows the image regions that influenced the prediction.</p></article>
        <article><span>✓</span><h3>Research-grade model</h3><p>ResNet50 trained for Blight, Common Rust, Gray Leaf Spot and Healthy leaves.</p></article>
        <article><span>⌁</span><h3>Built for phones</h3><p>Install it as a PWA and launch directly from your home screen.</p></article>
      </div></section>
    </main>
    <footer>Amaizing - AI-Powered Maize Disease Detection • 2026<span className="footer-credit">Built, owned &amp; powered by Firstman Noah Otobo</span></footer>
    {message && <div className="toast" role="status">{message}</div>}
    {!installed && showInstall && <div className="install-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) dismissInstall() }}>
      <section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <button className="install-close" type="button" aria-label="Close installation prompt" onClick={dismissInstall}>×</button>
        <img src="/icons/icon-192.png" alt="" width="76" height="76"/>
        <div className="install-copy">
          <span className="eyebrow">Use it like a native app</span>
          <h2 id="install-title">Install Amaizing</h2>
          {installPrompt
            ? <p>Add Amaizing to your device for a full-screen experience, quick home-screen access and an offline-ready app shell.</p>
            : isIos
              ? <p>In Safari, tap the <strong>Share</strong> button, then choose <strong>Add to Home Screen</strong> and confirm.</p>
              : <p>Open your browser menu and choose <strong>Install Amaizing</strong> or <strong>Add to Home screen</strong>. Installation requires HTTPS or localhost.</p>}
          <p className="install-credit">Built, owned &amp; powered by Firstman Noah Otobo</p>
          <div className="install-actions">
            {installPrompt && <button className="button" type="button" onClick={installApp}>Install now</button>}
            <button className="button button-ghost" type="button" onClick={dismissInstall}>{installPrompt ? 'Maybe later' : 'Got it'}</button>
          </div>
        </div>
      </section>
    </div>}
  </>
}

export default App
