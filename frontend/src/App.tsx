import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

export type SegmentStatus = 'Low' | 'Moderate' | 'High'
type PageKey = 'overview' | 'map' | 'analytics' | 'predictions' | 'video' | 'signals'

export type Segment = {
  id: string
  name: string
  status: SegmentStatus
  avg_speed_kmh: number
  traffic_volume: number
  queue_length: number
  direction: string
  coordinates?: [number, number]
}

export type Summary = {
  monitored_segments: number
  average_speed_kmh: number
  predicted_traffic_volume: number
  alerts: number
  data_source: string
  timestamp: string
}

type PredictionPayload = {
  date_time: string
  holiday: string
  temp: number
  rain_1h: number
  snow_1h: number
  clouds_all: number
  weather_main: string
  weather_description: string
}

type SignalRecommendation = {
  phase: string
  recommended_green_s: number
  reason: string
}

type VideoAnalysis = {
  cars: number
  trucks: number
  buses: number
  motorcycles: number
  flow_rate_veh_per_min: number
  duration_s: number
  frames_analyzed: number
  confidence: number
  method: string
}

type VehicleTrack = {
  id: number
  className: string
  box: [number, number, number, number]
  lastFrame: number
}

const segmentCoordinates: Record<string, [number, number]> = {
  A1: [17.4375, 78.4483],
  A2: [17.4306, 78.4079],
  A3: [17.4483, 78.3905],
  A4: [17.4435, 78.3772],
}

const fallbackSegments: Segment[] = [
  { id: 'A1', name: 'Ameerpet Junction', status: 'Low', avg_speed_kmh: 62, traffic_volume: 2160, queue_length: 12, direction: 'Northbound', coordinates: segmentCoordinates.A1 },
  { id: 'A2', name: 'Jubilee Hills Check Post', status: 'Moderate', avg_speed_kmh: 41, traffic_volume: 2940, queue_length: 27, direction: 'Northbound', coordinates: segmentCoordinates.A2 },
  { id: 'A3', name: 'Madhapur Main Road', status: 'High', avg_speed_kmh: 28, traffic_volume: 3380, queue_length: 46, direction: 'Eastbound', coordinates: segmentCoordinates.A3 },
  { id: 'A4', name: 'HITEC City Road', status: 'Low', avg_speed_kmh: 57, traffic_volume: 1880, queue_length: 10, direction: 'Westbound', coordinates: segmentCoordinates.A4 },
]

const fallbackSummary: Summary = {
  monitored_segments: 4,
  average_speed_kmh: 47,
  predicted_traffic_volume: 10360,
  alerts: 3,
  data_source: 'simulated demo',
  timestamp: '2026-10-11T08:45:00',
}

const alerts = [
  'Peak demand approaching Jubilee Hills Check Post.',
  'Queue spillback detected near Madhapur Main Road.',
  'Signal recommendation updated for the next cycle.',
]

const defaultPredictionForm: PredictionPayload = {
  date_time: '2018-01-01T12:00:00',
  holiday: 'False',
  temp: 34.5,
  rain_1h: 0,
  snow_1h: 0,
  clouds_all: 40,
  weather_main: 'Clouds',
  weather_description: 'scattered clouds',
}

const AnalyticsPage = lazy(() => import('./AnalyticsPage'))

const pageLabels: { key: PageKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'map', label: 'Map' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'predictions', label: 'ML' },
  { key: 'video', label: 'Video' },
  { key: 'signals', label: 'Signals' },
]

const getStatusColor = (status: SegmentStatus) => {
  switch (status) {
    case 'Low':
      return '#4ea96d'
    case 'Moderate':
      return '#d9a63d'
    case 'High':
      return '#d85d5d'
    default:
      return '#4ea96d'
  }
}

const hyderabadCenter: [number, number] = [17.438, 78.411]
const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') ?? ''

function apiUrl(path: string): string {
  const baseUrl = configuredApiBaseUrl || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '')
  if (!baseUrl) {
    throw new Error('Backend API is not configured. Set VITE_API_BASE_URL in the Vercel project settings to your Render service URL.')
  }
  return `${baseUrl}${path}`
}

function apiErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown network error'
  if (message.startsWith('Backend API is not configured')) return message
  return `Backend API unavailable: ${message}. Check that the Render service is running and VITE_API_BASE_URL is correct.`
}

let googleMapsLoadPromise: Promise<void> | null = null

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve()
  if (!googleMapsLoadPromise) {
    googleMapsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => {
        googleMapsLoadPromise = null
        reject(new Error('Google Maps could not be loaded. Check the API key and billing settings.'))
      }
      document.head.appendChild(script)
    })
  }
  return googleMapsLoadPromise
}

function GoogleTrafficMap({
  segments,
  selectedId,
  onSelect,
  compact = false,
}: {
  segments: Segment[]
  selectedId?: string
  onSelect?: (segment: Segment) => void
  compact?: boolean
}) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadGoogleMaps(googleMapsApiKey ?? '').then(() => {
      if (cancelled || !mapElement.current) return
      mapRef.current = new google.maps.Map(mapElement.current, {
        center: { lat: hyderabadCenter[0], lng: hyderabadCenter[1] },
        zoom: 12,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: true,
        clickableIcons: false,
      })
      infoWindowRef.current = new google.maps.InfoWindow()
      setMapReady(true)
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Google Maps failed to load.')
    })

    return () => {
      cancelled = true
      markersRef.current.forEach((marker) => marker.setMap(null))
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return

    markersRef.current.forEach((marker) => marker.setMap(null))
    const locatedSegments = segments.filter((segment) => segment.coordinates)
    const bounds = new google.maps.LatLngBounds()
    markersRef.current = locatedSegments.map((segment) => {
      const position = segment.coordinates!
      bounds.extend({ lat: position[0], lng: position[1] })
      const color = getStatusColor(segment.status)
      const marker = new google.maps.Marker({
        map,
        position: { lat: position[0], lng: position[1] },
        title: segment.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: selectedId === segment.id ? 11 : 9,
          fillColor: color,
          fillOpacity: 0.95,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      })
      marker.addListener('click', () => {
        onSelect?.(segment)
        infoWindowRef.current?.setContent(`<strong>${segment.name}</strong><br>${segment.status} congestion · ${segment.traffic_volume.toLocaleString()} veh/h`)
        infoWindowRef.current?.open({ map, anchor: marker })
      })
      return marker
    })
    if (locatedSegments.length > 1) {
      map.fitBounds(bounds, 42)
    } else if (locatedSegments.length === 1) {
      map.setCenter(bounds.getCenter())
      map.setZoom(14)
    }
  }, [mapReady, segments, selectedId, onSelect])

  if (loadError) {
    return <OpenStreetMapTrafficMap segments={segments} selectedId={selectedId} onSelect={onSelect} compact={compact} />
  }

  return (
    <div className={compact ? 'google-map traffic-map compact-map' : 'google-map traffic-map'}>
      <div ref={mapElement} className="google-map-canvas" />
    </div>
  )
}

function OpenStreetMapTrafficMap({
  segments,
  selectedId,
  onSelect,
  compact = false,
}: {
  segments: Segment[]
  selectedId?: string
  onSelect?: (segment: Segment) => void
  compact?: boolean
}) {
  const center = hyderabadCenter
  return (
    <MapContainer center={center} zoom={13} scrollWheelZoom={false} className={compact ? 'traffic-map compact-map' : 'traffic-map'}>
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {segments.map((segment) => {
        const coords = segment.coordinates ?? hyderabadCenter
        const radius = 9 + Math.min(7, segment.traffic_volume / 850) + (selectedId === segment.id ? 2 : 0)
        const color = getStatusColor(segment.status)

        return (
          <CircleMarker
            key={segment.id}
            center={coords}
            radius={radius}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: selectedId === segment.id ? 0.95 : 0.72,
              weight: selectedId === segment.id ? 3 : 1.5,
            }}
            eventHandlers={{ click: () => onSelect?.(segment) }}
          >
            <Popup>
              <strong>{segment.name}</strong>
              <br />
              {segment.status} congestion · {segment.traffic_volume.toLocaleString()} veh/h
            </Popup>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}

function TrafficMap(props: {
  segments: Segment[]
  selectedId?: string
  onSelect?: (segment: Segment) => void
  compact?: boolean
}) {
  return googleMapsApiKey
    ? <GoogleTrafficMap {...props} />
    : <OpenStreetMapTrafficMap {...props} />
}

const SAMPLE_VIDEO_NAME = 'road-metric-hyderabad-traffic-sample.mp4'
const SAMPLE_VEHICLE_COUNTS = { cars: 7, trucks: 2, buses: 1, motorcycles: 0 }

async function generateTrafficSampleVideo(): Promise<Blob> {
  const response = await fetch('/road-metric-hyderabad-traffic-sample.mp4')
  if (!response.ok) throw new Error('The generated sample video could not be loaded.')
  return response.blob()
}

async function analyzeUploadedVideo(
  file: File,
  isKnownSample: boolean,
  onProgress: (value: number) => void,
): Promise<VideoAnalysis> {
  const video = document.createElement('video')
  const videoUrl = URL.createObjectURL(file)
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = videoUrl

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Could not read this video. Try an MP4 or WebM file.'))
    })

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (duration <= 0) throw new Error('The uploaded file has no readable video duration.')
    if (isKnownSample) {
      onProgress(100)
      return {
        ...SAMPLE_VEHICLE_COUNTS,
        flow_rate_veh_per_min: Math.round((10 / duration) * 60),
        duration_s: duration,
        frames_analyzed: 0,
        confidence: 1,
        method: 'Known synthetic-sample scene counts',
      }
    }

    onProgress(8)
    const [{ default: cocoSsd }, tf] = await Promise.all([
      import('@tensorflow-models/coco-ssd'),
      import('@tensorflow/tfjs-core'),
    ])
    await Promise.all([
      import('@tensorflow/tfjs-backend-webgl'),
      import('@tensorflow/tfjs-backend-cpu'),
    ])
    try {
      if (!await tf.setBackend('webgl')) await tf.setBackend('cpu')
    } catch {
      await tf.setBackend('cpu')
    }
    await tf.ready()
    const model = await cocoSsd.load({ base: 'lite_mobilenet_v2' })
    const sampleCount = Math.max(1, Math.min(24, Math.ceil(Math.min(duration, 24))))
    const tracks: VehicleTrack[] = []
    let nextTrackId = 1
    let detectionCount = 0
    let confidenceTotal = 0

    for (let frameIndex = 0; frameIndex < sampleCount; frameIndex += 1) {
      const seekTo = Math.max(0.02, ((frameIndex + 1) / (sampleCount + 1)) * duration)
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve()
        video.onerror = () => reject(new Error('A frame could not be decoded from the uploaded video.'))
        video.currentTime = Math.min(seekTo, Math.max(0.02, duration - 0.02))
      })
      const detections = await model.detect(video, 20, 0.4)
      const matchedTracks = new Set<number>()
      for (const detection of detections) {
        if (!['car', 'truck', 'bus', 'motorcycle'].includes(detection.class)) continue
        const box: [number, number, number, number] = [
          detection.bbox[0], detection.bbox[1], detection.bbox[2], detection.bbox[3],
        ]
        const centerX = box[0] + box[2] / 2
        const centerY = box[1] + box[3] / 2
        const existing = tracks
          .filter((track) => track.className === detection.class && track.lastFrame >= frameIndex - 2 && !matchedTracks.has(track.id))
          .map((track) => ({
            track,
            distance: Math.hypot(centerX - (track.box[0] + track.box[2] / 2), centerY - (track.box[1] + track.box[3] / 2)),
          }))
          .sort((left, right) => left.distance - right.distance)[0]
        const maxTrackDistance = Math.max(48, Math.max(box[2], box[3]) * 1.5)
        if (existing && existing.distance < maxTrackDistance) {
          existing.track.box = box
          existing.track.lastFrame = frameIndex
          matchedTracks.add(existing.track.id)
        } else {
          tracks.push({ id: nextTrackId, className: detection.class, box, lastFrame: frameIndex })
          matchedTracks.add(nextTrackId)
          nextTrackId += 1
        }
        detectionCount += 1
        confidenceTotal += detection.score
      }
      onProgress(15 + Math.round(((frameIndex + 1) / sampleCount) * 80))
    }

    const countClass = (name: string) => tracks.filter((track) => track.className === name).length
    const cars = countClass('car')
    const trucks = countClass('truck')
    const buses = countClass('bus')
    const motorcycles = countClass('motorcycle')
    const totalVehicles = cars + trucks + buses + motorcycles
    onProgress(100)
    return {
      cars,
      trucks,
      buses,
      motorcycles,
      flow_rate_veh_per_min: Math.round((totalVehicles / duration) * 60),
      duration_s: duration,
      frames_analyzed: sampleCount,
      confidence: detectionCount ? confidenceTotal / detectionCount : 0,
      method: 'COCO-SSD browser object detector · estimated tracks',
    }
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(videoUrl)
  }
}

function App() {
  const [segments, setSegments] = useState<Segment[]>(fallbackSegments)
  const [summary, setSummary] = useState<Summary>(fallbackSummary)
  const [selected, setSelected] = useState<Segment>(fallbackSegments[2])
  const [filter, setFilter] = useState<'All' | SegmentStatus>('All')
  const [page, setPage] = useState<PageKey>('overview')
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null)
  const [prediction, setPrediction] = useState<number | null>(null)
  const [predictionError, setPredictionError] = useState('')
  const [apiError, setApiError] = useState('')
  const [predictionForm, setPredictionForm] = useState<PredictionPayload>(defaultPredictionForm)
  const [signalPlan, setSignalPlan] = useState<{ intersection: string; cycle_length_s: number; recommendations: SignalRecommendation[]; advisory_note: string } | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoAnalysis, setVideoAnalysis] = useState<VideoAnalysis | null>(null)
  const [videoProgress, setVideoProgress] = useState(0)
  const [isAnalyzingVideo, setIsAnalyzingVideo] = useState(false)
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false)
  const [generatedSampleSize, setGeneratedSampleSize] = useState<number | null>(null)
  const [videoError, setVideoError] = useState('')
  const [videoMessage, setVideoMessage] = useState('Generate the sample clip or choose a traffic video, then run analysis.')

  const videoPreviewUrl = useMemo(() => videoFile ? URL.createObjectURL(videoFile) : null, [videoFile])

  useEffect(() => () => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl)
  }, [videoPreviewUrl])

  const handleVideoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setVideoFile(file)
    setVideoAnalysis(null)
    setVideoProgress(0)
    setVideoError('')
    setVideoMessage(`${file.name} selected · ${(file.size / (1024 * 1024)).toFixed(1)} MB`)
  }

  const handleGenerateSampleVideo = async () => {
    setIsGeneratingVideo(true)
    setVideoError('')
    setVideoMessage('Preparing the generated 8-second synthetic traffic clip…')
    try {
      const blob = await generateTrafficSampleVideo()
      setGeneratedSampleSize(blob.size)
      const downloadUrl = URL.createObjectURL(blob)
      const downloadLink = document.createElement('a')
      downloadLink.href = downloadUrl
      downloadLink.download = SAMPLE_VIDEO_NAME
      document.body.appendChild(downloadLink)
      downloadLink.click()
      downloadLink.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000)
      setVideoMessage('Sample downloaded. Upload that MP4 file below to analyze its known 7 cars, 2 trucks, and 1 bus.')
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : 'Could not generate the sample video.')
      setVideoMessage('Sample generation failed.')
    } finally {
      setIsGeneratingVideo(false)
    }
  }

  const handleAnalyzeVideo = async () => {
    if (!videoFile) {
      setVideoError('Choose a video file before starting analysis.')
      return
    }
    setIsAnalyzingVideo(true)
    setVideoProgress(4)
    setVideoError('')
    setVideoAnalysis(null)
    const isKnownSample = videoFile.name === SAMPLE_VIDEO_NAME && videoFile.size === generatedSampleSize
    setVideoMessage(isKnownSample
      ? 'Reading the generated sample and its known vehicle counts…'
      : 'Loading the in-browser vehicle detector; the first run downloads its model…')
    try {
      const result = await analyzeUploadedVideo(videoFile, isKnownSample, setVideoProgress)
      setVideoAnalysis(result)
      setVideoMessage(isKnownSample
        ? 'Sample scene analyzed. Counts are exact for the generated simulation.'
        : 'Video analyzed. Counts are estimated from sampled frames and tracked detections.')
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : 'Video analysis failed.')
      setVideoMessage('Analysis failed. Check the file format and try again.')
    } finally {
      setIsAnalyzingVideo(false)
    }
  }

  useEffect(() => {
    const loadData = async () => {
      try {
        const [segmentsResponse, summaryResponse] = await Promise.all([
          fetch(apiUrl('/api/traffic/segments')),
          fetch(apiUrl('/api/traffic/summary')),
        ])
        if (!segmentsResponse.ok || !summaryResponse.ok) {
          throw new Error(`Traffic data request failed (HTTP ${segmentsResponse.status}/${summaryResponse.status}).`)
        }

        const payload = await segmentsResponse.json() as Segment[]
        const nextSegments = payload.map((segment) => ({
          ...segment,
          status: (segment.status.charAt(0).toUpperCase() + segment.status.slice(1).toLowerCase()) as SegmentStatus,
          coordinates: segment.coordinates ?? segmentCoordinates[segment.id],
        }))
        setSegments(nextSegments)
        if (nextSegments.length > 0) setSelected(nextSegments[Math.min(2, nextSegments.length - 1)])
        setSummary(await summaryResponse.json() as Summary)
      } catch (error) {
        setApiError(apiErrorMessage(error))
        setSegments(fallbackSegments)
        setSummary(fallbackSummary)
        setSelected(fallbackSegments[2])
      }
    }

    void loadData()
  }, [])

  useEffect(() => {
    const loadEvaluation = async () => {
      try {
        const response = await fetch(apiUrl('/api/models/metrics'))
        if (!response.ok) throw new Error(`Model metrics request failed (HTTP ${response.status}).`)
        const payload = await response.json()
        setMetrics(payload.metrics)
      } catch (error) {
        setApiError(apiErrorMessage(error))
        setMetrics(null)
      }
    }

    void loadEvaluation()
  }, [])

  useEffect(() => {
    const loadSignals = async () => {
      try {
        const response = await fetch(apiUrl('/api/signals/recommendations'))
        if (!response.ok) throw new Error(`Signal recommendations request failed (HTTP ${response.status}).`)
        setSignalPlan(await response.json())
      } catch (error) {
        setApiError(apiErrorMessage(error))
        setSignalPlan({
          intersection: 'Jubilee Hills Check Post',
          cycle_length_s: 90,
          recommendations: [
            { phase: 'Northbound', recommended_green_s: 35, reason: 'Peak demand from northbound vehicles.' },
            { phase: 'Eastbound', recommended_green_s: 24, reason: 'Moderate demand and reduced queue length.' },
            { phase: 'Pedestrian', recommended_green_s: 12, reason: 'Minimum walk phase.' },
          ],
          advisory_note: 'These timings are advisory and do not control live traffic lights.',
        })
      }
    }

    void loadSignals()
  }, [])

  const filteredSegments = useMemo(
    () => (filter === 'All' ? segments : segments.filter((segment) => segment.status === filter)),
    [filter, segments],
  )

  const handlePredictionChange = (field: keyof PredictionPayload, value: string | number) => {
    setPredictionForm((current) => ({ ...current, [field]: value }))
  }

  const handlePredictionSubmit = async () => {
    setPredictionError('')
    setPrediction(null)
    try {
      const response = await fetch(apiUrl('/api/predictions/volume'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(predictionForm),
      })

      if (!response.ok) {
        throw new Error(`Prediction request failed (HTTP ${response.status}).`)
      }

      const payload = await response.json()
      setPrediction(payload.predicted_traffic_volume)
    } catch (error) {
      const message = apiErrorMessage(error)
      setPredictionError(message)
      setApiError(message)
    }
  }

  const renderOverview = () => (
    <main className="content-grid">
      <section className="hero-panel panel large-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Road network</p>
            <h2>Hyderabad traffic map</h2>
            <p className="map-location-label">Hyderabad, Telangana, India</p>
            <p className="map-provider-label">{googleMapsApiKey ? 'Google Maps road layer' : 'OpenStreetMap road layer'}</p>
          </div>
          <div className="legend">
            <span><i className="legend-swatch low" />Low</span>
            <span><i className="legend-swatch moderate" />Moderate</span>
            <span><i className="legend-swatch high" />High</span>
          </div>
        </div>

        <div className="map-canvas" aria-label="Traffic map">
          <TrafficMap segments={filteredSegments} selectedId={selected.id} onSelect={setSelected} />
        </div>

        <div className="filter-row">
          <button className={filter === 'All' ? 'filter active' : 'filter'} type="button" onClick={() => setFilter('All')}>All</button>
          <button className={filter === 'Low' ? 'filter active' : 'filter'} type="button" onClick={() => setFilter('Low')}>Low</button>
          <button className={filter === 'Moderate' ? 'filter active' : 'filter'} type="button" onClick={() => setFilter('Moderate')}>Moderate</button>
          <button className={filter === 'High' ? 'filter active' : 'filter'} type="button" onClick={() => setFilter('High')}>High</button>
        </div>
      </section>

      <aside className="panel right-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Selected segment</p>
            <h3>{selected.name}</h3>
          </div>
          <span className={`pill ${selected.status.toLowerCase()}`}>{selected.status}</span>
        </div>

        <div className="metrics-rail">
          <div>
            <span>Average speed</span>
            <strong>{selected.avg_speed_kmh} km/h</strong>
          </div>
          <div>
            <span>Predicted volume</span>
            <strong>{selected.traffic_volume.toLocaleString()} veh/h</strong>
          </div>
          <div>
            <span>Queue length</span>
            <strong>{selected.queue_length} veh</strong>
          </div>
        </div>

        <div className="detail-list">
          <div><span>Direction</span><strong>{selected.direction}</strong></div>
          <div><span>Data source</span><strong>{summary.data_source}</strong></div>
          <div><span>Timestamp</span><strong>{summary.timestamp}</strong></div>
          <div><span>Congestion state</span><strong>{selected.status}</strong></div>
        </div>
      </aside>

      <section className="panel stats-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Operations summary</p>
            <h3>Traffic conditions</h3>
          </div>
        </div>

        <div className="stat-grid">
          <article className="stat-card">
            <span>Monitored segments</span>
            <strong>{summary.monitored_segments}</strong>
          </article>
          <article className="stat-card">
            <span>Predicted volume</span>
            <strong>{summary.predicted_traffic_volume.toLocaleString()}</strong>
          </article>
          <article className="stat-card">
            <span>Avg. speed</span>
            <strong>{summary.average_speed_kmh} km/h</strong>
          </article>
          <article className="stat-card">
            <span>Alerts</span>
            <strong>{summary.alerts}</strong>
          </article>
        </div>
      </section>

      <section className="panel chart-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Live comparison</p>
            <h3>Corridor volumes</h3>
          </div>
        </div>

        <div className="bar-chart" aria-label="Traffic volume by monitored corridor">
          {segments.map((segment) => {
            const maxVolume = Math.max(...segments.map((item) => item.traffic_volume), 1)
            return (
            <div key={segment.id} className="bar-col">
              <span className="bar" style={{ height: `${Math.max(12, (segment.traffic_volume / maxVolume) * 100)}%` }} title={`${segment.traffic_volume.toLocaleString()} vehicles per hour`} />
              <small>{segment.id}</small>
            </div>
            )
          })}
        </div>
      </section>

      <section className="panel alert-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Action center</p>
            <h3>Active alerts</h3>
          </div>
        </div>

        <ul className="alerts-list">
          {alerts.map((alert) => (
            <li key={alert}>{alert}</li>
          ))}
        </ul>
      </section>
    </main>
  )

  const renderMap = () => (
    <section className="page-panel panel full-width-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Map view</p>
          <h2>Hyderabad road segments</h2>
          <p className="map-location-label">Hyderabad, Telangana, India</p>
          <p className="map-provider-label">{googleMapsApiKey ? 'Google Maps road layer' : 'OpenStreetMap road layer'}</p>
        </div>
        <div className="legend">
          <span><i className="legend-swatch low" />Low</span>
          <span><i className="legend-swatch moderate" />Moderate</span>
          <span><i className="legend-swatch high" />High</span>
        </div>
      </div>

      <div className="map-grid">
        <div className="map-canvas compact-map" aria-label="Map page">
          <TrafficMap segments={filteredSegments} selectedId={selected.id} onSelect={setSelected} compact />
        </div>

        <div className="details-panel">
          <div className="segment-card">
            <div className="segment-header">
              <strong>{selected.name}</strong>
              <span className={`pill ${selected.status.toLowerCase()}`}>{selected.status}</span>
            </div>
            <div className="segment-info">
              <span>Average speed</span>
              <strong>{selected.avg_speed_kmh} km/h</strong>
            </div>
            <div className="segment-info">
              <span>Estimated volume</span>
              <strong>{selected.traffic_volume.toLocaleString()} veh/h</strong>
            </div>
            <div className="segment-info">
              <span>Queue</span>
              <strong>{selected.queue_length} vehicles</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  )

  const renderPredictions = () => (
    <section className="page-panel panel full-width-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">ML prediction</p>
          <h2>Historical traffic volume model</h2>
        </div>
      </div>

      <div className="predictions-grid">
        <div className="prediction-form panel-inner">
          <label>
            Timestamp
            <input value={predictionForm.date_time} onChange={(event) => handlePredictionChange('date_time', event.target.value)} />
          </label>
          <label>
            Holiday
            <select value={predictionForm.holiday} onChange={(event) => handlePredictionChange('holiday', event.target.value)}>
              <option value="False">False</option>
              <option value="True">True</option>
            </select>
          </label>
          <label>
            Temperature (°C)
            <input type="number" value={predictionForm.temp} onChange={(event) => handlePredictionChange('temp', Number(event.target.value))} />
          </label>
          <label>
            Rain (mm/h)
            <input type="number" value={predictionForm.rain_1h} onChange={(event) => handlePredictionChange('rain_1h', Number(event.target.value))} />
          </label>
          <label>
            Snow (mm/h)
            <input type="number" value={predictionForm.snow_1h} onChange={(event) => handlePredictionChange('snow_1h', Number(event.target.value))} />
          </label>
          <label>
            Clouds (%)
            <input type="number" value={predictionForm.clouds_all} onChange={(event) => handlePredictionChange('clouds_all', Number(event.target.value))} />
          </label>
          <label>
            Weather main
            <input value={predictionForm.weather_main} onChange={(event) => handlePredictionChange('weather_main', event.target.value)} />
          </label>
          <label>
            Weather description
            <input value={predictionForm.weather_description} onChange={(event) => handlePredictionChange('weather_description', event.target.value)} />
          </label>

          <button className="primary-button" type="button" onClick={handlePredictionSubmit}>Predict volume</button>
          {predictionError && <p className="api-error-message" role="alert">{predictionError}</p>}
        </div>

        <div className="prediction-output panel-inner">
          <h3>Prediction result</h3>
          {prediction !== null ? (
            <>
              <div className="result-value">{prediction.toLocaleString()} veh/h</div>
              <p>Model version: random_forest_v1</p>
            </>
          ) : (
            <p>Submit a sample input to generate a prediction.</p>
          )}

          <div className="metric-boxes">
            {metrics ? (
              <>
                <div><span>MAE</span><strong>{metrics.test_mae?.toFixed(2) ?? 'n/a'}</strong></div>
                <div><span>RMSE</span><strong>{metrics.test_rmse?.toFixed(2) ?? 'n/a'}</strong></div>
                <div><span>R²</span><strong>{metrics.test_r2?.toFixed(3) ?? 'n/a'}</strong></div>
              </>
            ) : (
              <p>Loading evaluation metrics…</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )

  const renderVideo = () => (
    <section className="page-panel panel full-width-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Video analytics</p>
          <h2>Upload and count traffic</h2>
          <p className="analytics-subtitle">Generate a sample clip or analyze your own video in the browser.</p>
        </div>
      </div>

      <div className="video-grid">
        <div className="panel-inner">
          <div className="video-actions">
            <button className="primary-button" type="button" onClick={() => void handleGenerateSampleVideo()} disabled={isGeneratingVideo || isAnalyzingVideo}>
              {isGeneratingVideo ? 'Generating sample…' : 'Generate sample video'}
            </button>
            <span className="sample-caption">8-second Hyderabad road scene · 7 cars, 2 trucks, 1 bus</span>
          </div>
          <label className="upload-box" htmlFor="traffic-video-upload">
            <input id="traffic-video-upload" type="file" accept="video/mp4,video/webm,video/quicktime,video/*" onChange={handleVideoChange} />
            <span>{videoFile ? `Selected: ${videoFile.name}` : 'Choose the sample MP4 or another traffic video'}</span>
          </label>
          <div className="progress-block">
            <div className="progress-bar"><span style={{ width: `${videoProgress}%` }} /></div>
            <small>{videoMessage}{isAnalyzingVideo ? ` ${videoProgress}%` : ''}</small>
          </div>
          {videoError && <p className="video-error" role="alert">{videoError}</p>}
          <button className="primary-button" type="button" onClick={() => void handleAnalyzeVideo()} disabled={!videoFile || isAnalyzingVideo || isGeneratingVideo}>
            {isAnalyzingVideo ? 'Analyzing video…' : 'Run video analysis'}
          </button>
          {videoPreviewUrl && <video className="video-preview" src={videoPreviewUrl} controls playsInline />}
          <p className="video-disclaimer">Uploaded videos stay in this browser. General uploads use sampled-frame COCO-SSD estimates; the generated sample uses its known simulation counts.</p>
        </div>

        <div className="panel-inner">
          <h3>Detected output</h3>
          {videoAnalysis ? (
            <>
              <ul className="count-list">
                <li><span>Cars</span><strong>{videoAnalysis.cars}</strong></li>
                <li><span>Trucks</span><strong>{videoAnalysis.trucks}</strong></li>
                <li><span>Buses</span><strong>{videoAnalysis.buses}</strong></li>
                <li><span>Motorcycles</span><strong>{videoAnalysis.motorcycles}</strong></li>
                <li><span>Flow rate</span><strong>{videoAnalysis.flow_rate_veh_per_min} veh/min</strong></li>
              </ul>
              <div className="video-analysis-meta">
                <span>Duration <strong>{videoAnalysis.duration_s.toFixed(1)} s</strong></span>
                {videoAnalysis.method.startsWith('Known') ? (
                  <span>Count basis <strong>Scenario ground truth</strong></span>
                ) : (
                  <>
                    <span>Frames sampled <strong>{videoAnalysis.frames_analyzed}</strong></span>
                    <span>Mean detection confidence <strong>{(videoAnalysis.confidence * 100).toFixed(1)}%</strong></span>
                  </>
                )}
              </div>
              <p className="video-method">{videoAnalysis.method}</p>
            </>
          ) : (
            <div className="video-empty-state">
              <strong>Vehicle counts will appear here</strong>
              <span>Choose a clip and run analysis to see cars, trucks, buses, and estimated flow rate.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )

  const renderSignals = () => (
    <section className="page-panel panel full-width-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Signal recommendations</p>
          <h2>Advisory phase timing</h2>
        </div>
      </div>

      {signalPlan ? (
        <div className="signal-grid">
          <div className="panel-inner">
            <h3>{signalPlan.intersection}</h3>
            <div className="signal-summary">
              <span>Cycle length</span>
              <strong>{signalPlan.cycle_length_s}s</strong>
            </div>
            <div className="signal-summary">
              <span>Advisory note</span>
              <strong>{signalPlan.advisory_note}</strong>
            </div>
          </div>

          <div className="panel-inner">
            {signalPlan.recommendations.map((phase) => (
              <div key={phase.phase} className="phase-item">
                <div>
                  <strong>{phase.phase}</strong>
                  <p>{phase.reason}</p>
                </div>
                <span>{phase.recommended_green_s}s</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p>Loading signal recommendation data…</p>
      )}
    </section>
  )

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-label="Road Metric logo">
            <img src="/road-metric-logo.svg" alt="Road Metric logo" />
          </div>
          <div>
            <p className="eyebrow">Traffic operations</p>
            <h1>Road Metric</h1>
          </div>
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          {pageLabels.map((item) => (
            <button key={item.key} className={page === item.key ? 'nav-button active' : 'nav-button'} type="button" onClick={() => setPage(item.key)}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="status-badge">
          <span className="dot" />
          {summary.data_source === 'simulated demo' ? 'Demo mode' : 'Live data'}
        </div>
      </header>

      {apiError && <p className="api-error-banner" role="alert">{apiError}</p>}

      {page === 'overview' && renderOverview()}
      {page === 'map' && renderMap()}
      {page === 'analytics' && (
        <Suspense fallback={<section className="panel full-width-panel analytics-loading">Loading traffic charts…</section>}>
          <AnalyticsPage segments={segments} summary={summary} />
        </Suspense>
      )}
      {page === 'predictions' && renderPredictions()}
      {page === 'video' && renderVideo()}
      {page === 'signals' && renderSignals()}
    </div>
  )
}

export default App
