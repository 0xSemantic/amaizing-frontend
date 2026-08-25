import { useEffect, useRef, useState } from 'react'

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

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
  const inputRef = useRef(null)

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

  function chooseFile(nextFile) {
    if (!nextFile) return
    if (!['image/jpeg', 'image/png'].includes(nextFile.type)) {
      setMessage('Please choose a JPEG or PNG image.')
      return
    }
    if (nextFile.size > 5 * 1024 * 1024) {
      setMessage('The image must be 5 MB or smaller.')
      return
    }
    if (preview) URL.revokeObjectURL(preview)
    setFile(nextFile)
    setPreview(URL.createObjectURL(nextFile))
    setResult(null)
  }

  function clearFile() {
    if (preview) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview('')
    setResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function analyze(event) {
    event.preventDefault()
    if (!file) return
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
        <a className="brand" href="#home">🌽 Amaizing</a>
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
            <div className="feature-pills" aria-label="Key features"><span>96–97% accuracy</span><span>Grad-CAM</span><span>Mobile-ready</span></div>
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
                <input ref={inputRef} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={event => chooseFile(event.target.files[0])}/>
                {!preview && <button className="drop-zone" type="button" onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]) }}>
                  <span className="upload-icon">☁</span><strong>Tap to take or choose a photo</strong><small>JPEG or PNG, up to 5 MB</small>
                </button>}
                {preview && <div className="preview"><img src={preview} alt="Selected maize leaf preview"/><button className="clear-button" type="button" onClick={clearFile} aria-label="Remove selected image">×</button></div>}
                <button className="button analyze-button" type="submit" disabled={!file || loading}>{loading ? <>Analyzing… <span className="spinner"/></> : 'Analyze Image'}</button>
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
    <footer>Amaizing – AI-Powered Maize Disease Detection • 2026</footer>
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
