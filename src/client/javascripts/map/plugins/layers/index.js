import { EVENTS } from '@defra/interactive-map'
import Overlay from 'ol/Overlay.js'
import ImageLayer from 'ol/layer/Image.js'
import ImageWMS from 'ol/source/ImageWMS.js'
import GeoTIFF from 'ol/source/GeoTIFF.js'
import WebGLTileLayer from 'ol/layer/WebGLTile.js'
import WebGLVectorLayer from 'ol/layer/WebGLVector.js'
import VectorSource from 'ol/source/Vector.js'
import { bbox } from 'ol/loadingstrategy.js'
import { createLoader } from 'flatgeobuf/lib/mjs/ol.js'
import { datasets } from '../../config/datasets.js'
import { mapStyles } from '../../config/map-styles.js'
import { datasetForLayer, layerIdFor } from '../../config/layers.js'
import { loadLyrxStyle } from './lyrx-style.js'
import {
  buildFeatureInfoFragment,
  buildKeyFragment,
  buildStatusFragment,
  renderFeatureInfoPanelHtml,
  renderKeyPanelHtml,
  renderLayersPanelHtml,
  IDENTIFY_ICON_SVG,
  KEY_ICON_SVG,
  LAYERS_ICON_SVG
} from './render.js'

const BUTTON_ID = 'gep-layers'
const PANEL_ID = 'gep-layers'
const INFO_BUTTON_ID = 'gep-layer-info-toggle'
const INFO_PANEL_ID = 'gep-layer-info'
const INFO_CONTENT_ID = 'gep-layer-info-content'
const INFO_STATUS_ID = 'gep-layer-info-status'
const KEY_BUTTON_ID = 'gep-key'
const KEY_PANEL_ID = 'gep-key'
const KEY_CONTENT_ID = 'gep-key-content'

const EPSG_27700 = 'EPSG:27700'
const UNKNOWN_LAYER_LABEL = 'Unknown Layer'

let listeners = null

export function registerLayersPanel (interactiveMap, map, initialStyleId) {
  listeners?.abort()
  listeners = new AbortController()

  registerLayerListPanel(interactiveMap, map, initialStyleId)
  registerIdentifyPanel(interactiveMap, map)
  registerHoverValues(map)
}

function setBaseAttribution (mapStyleId) {
  baseAttribution = mapStyles.find(s => s.id === mapStyleId)?.attribution ?? mapStyles[0].attribution
}

function registerLayerListPanel (interactiveMap, map, initialStyleId) {
  setBaseAttribution(initialStyleId)
  const refreshAttributions = () => refreshAttributionsForVisibleLayers(map)
  refreshAttributions()
  interactiveMap.on(EVENTS.MAP_STYLE_CHANGE, ({ mapStyleId }) => {
    setBaseAttribution(mapStyleId)
    refreshAttributions()
  })

  interactiveMap.addButton(BUTTON_ID, {
    id: BUTTON_ID,
    label: 'Layers',
    panelId: PANEL_ID,
    iconSvgContent: LAYERS_ICON_SVG,
    mobile: { slot: 'top-left', showLabel: false },
    tablet: { slot: 'top-left', showLabel: true },
    desktop: { slot: 'top-left', showLabel: true }
  })

  interactiveMap.addPanel(PANEL_ID, {
    id: PANEL_ID,
    label: 'Layers',
    html: renderLayersPanelHtml(datasets),
    mobile: { slot: 'drawer', open: false, modal: true, dismissible: true, showLabel: false },
    tablet: { slot: 'side', open: false, modal: false, width: '320px', dismissible: true, showLabel: false },
    desktop: { slot: 'side', open: false, modal: false, width: '320px', dismissible: true, showLabel: false }
  })

  interactiveMap.on(EVENTS.APP_PANEL_OPENED, ({ panelId }) => {
    if (panelId === PANEL_ID) {
      interactiveMap.toggleButtonState(BUTTON_ID, 'hidden', true)
    }
  })

  interactiveMap.on(EVENTS.APP_PANEL_CLOSED, ({ panelId }) => {
    if (panelId === PANEL_ID) {
      interactiveMap.toggleButtonState(BUTTON_ID, 'hidden', false)
    }
  })

  registerKeyPanel(interactiveMap)

  document.addEventListener('change', (event) => {
    const input = event.target.closest('[data-app-layer-id]')
    if (!input) {
      return
    }
    const dataset = datasets.find(d => d.id === input.dataset.appLayerId)
    if (!dataset) {
      return
    }
    const visible = input.checked
    setLayerInputLoading(input, true)
    toggleLayer(dataset, visible, map).catch((err) => {
      console.error(`Failed to load data layer ${dataset.id}`, err)
    }).finally(() => {
      // Keep UI state in sync with the map even when a layer update fails.
      if (visible && !findLayerById(map, layerIdFor(dataset))) {
        input.checked = false
      }
      refreshKey(map)
      refreshAttributions()
      setLayerInputLoading(input, false)
    })
  }, { signal: listeners.signal })

  document.addEventListener('submit', (event) => {
    if (!event.target.matches('[data-app-layer-search-form]')) {
      return
    }
    event.preventDefault()
    filterLayers(event.target.querySelector('[data-app-layer-search]')?.value ?? '')
  }, { signal: listeners.signal })

  document.addEventListener('search', (event) => {
    const search = event.target.closest('[data-app-layer-search]')
    if (search) {
      filterLayers(search.value)
    }
  }, { signal: listeners.signal })
}

function registerKeyPanel (interactiveMap) {
  interactiveMap.addButton(KEY_BUTTON_ID, {
    id: KEY_BUTTON_ID,
    label: 'Key',
    panelId: KEY_PANEL_ID,
    iconSvgContent: KEY_ICON_SVG,
    mobile: { slot: 'top-left', showLabel: false },
    tablet: { slot: 'top-left', showLabel: true },
    desktop: { slot: 'top-left', showLabel: true }
  })

  interactiveMap.addPanel(KEY_PANEL_ID, {
    id: KEY_PANEL_ID,
    label: 'Key',
    html: renderKeyPanelHtml(KEY_CONTENT_ID),
    mobile: { slot: 'drawer', open: false, modal: true, dismissible: true },
    tablet: { slot: 'left-top', open: false, modal: false, width: '450px', dismissible: true },
    desktop: { slot: 'left-top', open: false, modal: false, width: '450px', dismissible: true }
  })
}

function registerIdentifyPanel (interactiveMap, map) {
  let infoEnabled = false
  let identifyAbortController = null
  let doubleClickGuardTimeout = null

  const cancelIdentifyRequest = () => {
    if (doubleClickGuardTimeout) {
      clearTimeout(doubleClickGuardTimeout)
      doubleClickGuardTimeout = null
    }
    if (identifyAbortController) {
      identifyAbortController.abort()
      identifyAbortController = null
    }
  }

  interactiveMap.addButton(INFO_BUTTON_ID, {
    id: INFO_BUTTON_ID,
    label: 'Identify',
    iconSvgContent: IDENTIFY_ICON_SVG,
    isPressed: false,
    onClick: () => {
      infoEnabled = !infoEnabled
      interactiveMap.toggleButtonState(INFO_BUTTON_ID, 'pressed', infoEnabled)
      map.getTargetElement()?.classList.toggle('app-map--identify', infoEnabled)
      if (!infoEnabled) {
        cancelIdentifyRequest()
        interactiveMap.hidePanel(INFO_PANEL_ID)
      }
    },
    mobile: { slot: 'right-top', showLabel: false, order: 12 },
    tablet: { slot: 'right-top', showLabel: false, order: 12 },
    desktop: { slot: 'right-top', showLabel: false, order: 12 }
  })

  interactiveMap.addPanel(INFO_PANEL_ID, {
    id: INFO_PANEL_ID,
    label: 'Data Layer Attributes',
    html: renderFeatureInfoPanelHtml(INFO_STATUS_ID, INFO_CONTENT_ID),
    mobile: { slot: 'drawer', open: false, modal: true, dismissible: true },
    tablet: { slot: 'middle', open: false, modal: true, width: '500px', dismissible: true },
    desktop: { slot: 'middle', open: false, modal: true, width: '500px', dismissible: true }
  })

  interactiveMap.on(EVENTS.APP_PANEL_CLOSED, ({ panelId }) => {
    if (panelId === INFO_PANEL_ID) {
      cancelIdentifyRequest()
    }
  })

  interactiveMap.on(EVENTS.MAP_CLICK, ({ coords }) => {
    if (!infoEnabled || identifyAbortController) {
      return
    }
    if (doubleClickGuardTimeout) {
      clearTimeout(doubleClickGuardTimeout)
      doubleClickGuardTimeout = null
      return
    }
    doubleClickGuardTimeout = setTimeout(() => {
      doubleClickGuardTimeout = null
      const abortController = new AbortController()
      identifyAbortController = abortController
      showFeatureInfo(coords, map, interactiveMap, abortController.signal)
        .finally(() => {
          if (identifyAbortController === abortController) {
            identifyAbortController = null
          }
        })
    }, 250)
  })
}

function findLayerById (map, id) {
  return map.getLayers().getArray().find(l => l.get('id') === id)
}

function getSourceUrl (source) {
  return source.getUrls?.()?.[0] ?? source.getUrl?.()
}

function getVisibleWmsLayers (map) {
  return map.getLayers().getArray()
    .filter(layer =>
      layer.get('wms') &&
      layer.getVisible() &&
      layer.getSource()?.getParams()?.LAYERS &&
      getSourceUrl(layer.getSource())
    )
}

async function showFeatureInfo (coords, map, interactiveMap, signal) {
  const contentEl = document.getElementById(INFO_CONTENT_ID)
  const statusEl = document.getElementById(INFO_STATUS_ID)
  if (contentEl) {
    contentEl.setAttribute('aria-busy', 'true')
    contentEl.replaceChildren(buildStatusFragment('Loading data layer attributes...'))
  }
  updateStatus(statusEl, 'Loading attributes')
  interactiveMap.showPanel(INFO_PANEL_ID)

  const visibleLayers = getVisibleWmsLayers(map)

  const mapPoint = { x: coords[0], y: coords[1] }
  const results = await Promise.all(
    visibleLayers.map(layer => describeLayerFeatures(layer, mapPoint, map, signal))
  )
  if (signal.aborted) {
    return
  }

  const layersWithFeatures = results.filter(r => r.features.length > 0)
  const failedLayers = results.filter(r => r.error)
  if (layersWithFeatures.length === 0 && failedLayers.length === 0) {
    if (contentEl) {
      contentEl.removeAttribute('aria-busy')
      contentEl.replaceChildren(buildStatusFragment('No data layer attributes found at this location.'))
    }
    updateStatus(statusEl, 'No attributes found')
    return
  }

  if (contentEl) {
    contentEl.removeAttribute('aria-busy')
    contentEl.replaceChildren(buildFeatureInfoFragment(results))
  }
  updateStatus(statusEl, failedLayers.length > 0 ? 'Some attributes could not be loaded' : 'Attributes loaded')
}

async function describeLayerFeatures (layer, mapPoint, map, signal) {
  const dataset = datasetForLayer(layer, datasets)
  const layerName = dataset?.label ?? UNKNOWN_LAYER_LABEL

  try {
    const features = await fetchFeatureInfo(layer, mapPoint, map, signal)
    return { layerName, features, error: false }
  } catch {
    return { layerName, features: [], error: !signal.aborted }
  }
}

async function fetchFeatureInfo (layer, mapPoint, map, signal) {
  const source = layer.getSource()
  const layerNames = source.getParams().LAYERS
  if (!layerNames) {
    return []
  }

  const pixel = map.getPixelFromCoordinate([mapPoint.x, mapPoint.y])
  const view = map.getView()
  const size = map.getSize()
  const extent = view.calculateExtent(size)

  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetFeatureInfo',
    LAYERS: layerNames,
    QUERY_LAYERS: layerNames,
    INFO_FORMAT: 'application/json',
    CRS: EPSG_27700,
    BBOX: `${extent[0]},${extent[1]},${extent[2]},${extent[3]}`,
    WIDTH: String(Math.round(size[0])),
    HEIGHT: String(Math.round(size[1])),
    I: String(Math.round(pixel[0])),
    J: String(Math.round(pixel[1]))
  })

  const response = await fetch(`${getSourceUrl(source)}?${params}`, { signal })
  const data = await response.json()
  return data.features ?? []
}

function updateStatus (statusEl, message) {
  if (statusEl && statusEl.textContent !== message) {
    statusEl.textContent = message
  }
}

const capabilitiesCache = new Map()

export function resetCapabilitiesCache () {
  capabilitiesCache.clear()
}

async function fetchWmsLayerNames (wmsUrl) {
  if (capabilitiesCache.has(wmsUrl)) {
    return capabilitiesCache.get(wmsUrl)
  }

  try {
    const res = await fetch(`${wmsUrl}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`)
    if (!res.ok) {
      return []
    }

    const text = await res.text()
    const doc = new DOMParser().parseFromString(text, 'text/xml')
    const names = [...doc.querySelectorAll('Layer[queryable="1"] > Name')]
      .map(el => el.textContent)
      .filter(Boolean)

    if (names.length) {
      capabilitiesCache.set(wmsUrl, names)
    }
    return names
  } catch {
    return []
  }
}

function setLayerInputLoading (input, loading) {
  input.disabled = loading
  const item = input.closest('[data-app-layer-item]')
  if (!item) {
    return
  }

  if (!loading) {
    item.removeAttribute('aria-busy')
    return
  }

  item.setAttribute('aria-busy', 'true')
}

async function toggleLayer (dataset, visible, map) {
  const layerId = layerIdFor(dataset)
  const existing = findLayerById(map, layerId)
  if (existing) {
    existing.setVisible(visible)
    return
  }

  if (!visible) {
    return
  }

  const layer = await createLayer(dataset, layerId)
  if (!layer) {
    return
  }

  map.addLayer(layer)
}

async function createLayer (dataset, layerId) {
  const { type } = dataset.source
  if (type === 'cog') {
    return createCogLayer(dataset, layerId)
  } else if (type === 'fgb') {
    return createFlatGeobufLayer(dataset, layerId)
  } else if (type === 'wms') {
    return createWmsLayer(dataset, layerId)
  } else {
    return null
  }
}

async function createWmsLayer (dataset, layerId) {
  const layerNames = dataset.source.layers?.length
    ? dataset.source.layers
    : await fetchWmsLayerNames(dataset.source.url)

  if (!layerNames.length) {
    return null
  }

  const params = {
    LAYERS: layerNames.join(','),
    FORMAT: 'image/png',
    TRANSPARENT: true,
    CRS: EPSG_27700
  }

  return new ImageLayer({
    properties: { id: layerId, wms: true },
    source: new ImageWMS({
      url: dataset.source.url,
      params,
      attributions: dataset.source.attribution,
      ratio: 1.5,
      crossOrigin: 'anonymous'
    }),
    opacity: dataset.source.opacity ?? 1
  })
}

async function createCogLayer (dataset, layerId) {
  const { url, opacity, style, normalize, interpolate } = dataset.source

  return new WebGLTileLayer({
    properties: { id: layerId },
    source: new GeoTIFF({ sources: [{ url }], normalize, interpolate }),
    style: { color: style.color },
    opacity
  })
}

async function createFlatGeobufLayer (dataset, layerId) {
  const { url, styleUrl, attribution, opacity, lowercaseFields = false, style: manualStyle } = dataset.source
  const { style, maxResolution } = styleUrl ? await loadLyrxStyle(styleUrl, { lowercaseFields }) : {}
  const source = new VectorSource({ strategy: bbox, attributions: attribution })

  source.setLoader(createLoader(source, url, EPSG_27700, bbox))

  return new WebGLVectorLayer({
    properties: { id: layerId },
    source,
    maxResolution,
    style: manualStyle ?? style,
    opacity
  })
}

function refreshKey (map) {
  const contentEl = document.getElementById(KEY_CONTENT_ID)
  if (!contentEl) {
    return
  }

  const entries = getVisibleWmsLayers(map).map(layer => {
    const dataset = datasetForLayer(layer, datasets)
    const label = dataset?.label ?? UNKNOWN_LAYER_LABEL
    const source = layer.getSource()
    const layerNames = source.getParams().LAYERS
    const baseUrl = getSourceUrl(source)
    if (!layerNames || !baseUrl) {
      return null
    }
    return { label, baseUrl, layerNames: layerNames.split(',') }
  }).filter(Boolean)

  contentEl.replaceChildren(buildKeyFragment(entries))
}

let baseAttribution

function getCurrentAttribution (map) {
  const visibleAttributions = getVisibleWmsLayers(map)
    .map(layer => datasetForLayer(layer, datasets)?.source.attribution)
    .filter(Boolean)

  return [...new Set([baseAttribution, ...visibleAttributions])].join(' | ')
}

function refreshAttributionsForVisibleLayers (map) {
  const attribution = getCurrentAttribution(map)
  const attributionEl = document.querySelector('.im-c-attributions')
  if (attributionEl) {
    attributionEl.textContent = attribution
  }
}

// TODO: temp output to inspect the new operational dataset layers
// inspect functionality is being rewritten so dumping out here for now
function registerHoverValues (map) {
  const element = document.createElement('div')
  element.className = 'app-map__hover-info'
  element.setAttribute('aria-hidden', 'true')

  const overlay = new Overlay({ element, offset: [12, 0], positioning: 'center-left' })
  map.addOverlay(overlay)

  map.on('pointermove', (event) => {
    const groups = event.dragging ? [] : valuesAt(map, event.pixel)
    element.innerHTML = groups.map(toGroupHtml).join('')
    overlay.setPosition(groups.length ? event.coordinate : undefined)
  })
}

function toGroupHtml ({ label, values }) {
  const rows = values.map(([key, value]) => `<div><strong>${key}:</strong> ${value}</div>`)

  return `<div class="app-map__hover-info-group"><strong>${label}</strong>${rows.join('')}</div>`
}

function valuesAt (map, pixel) {
  const groups = []

  map.forEachFeatureAtPixel(pixel, (feature, layer) => {
    const geometryName = feature.getGeometryName()
    groups.push({
      label: datasetForLayer(layer, datasets)?.label ?? UNKNOWN_LAYER_LABEL,
      values: Object.entries(feature.getProperties()).filter(([key]) => key !== geometryName)
    })
  }, { hitTolerance: 0, layerFilter: (layer) => datasetForLayer(layer, datasets)?.source.type === 'fgb' })

  for (const layer of map.getLayers().getArray()) {
    const dataset = datasetForLayer(layer, datasets)
    if (dataset?.source.type !== 'cog' || !layer.getVisible()) {
      continue
    }

    // The last band is the mask, so slice it off to get the values.
    const bands = layer.getData(pixel)
    if (bands?.at(-1)) {
      groups.push({
        label: dataset.label,
        values: Array.from(bands.slice(0, -1), (value, index) => [`band ${index + 1}`, value])
      })
    }
  }

  return groups
}

function filterLayers (query) {
  const term = query.trim().toLowerCase()
  const items = document.querySelectorAll('[data-app-layer-item]')
  let visibleCount = 0
  items.forEach(item => {
    const match = !term || item.dataset.label.includes(term)
    item.hidden = !match
    if (match) {
      visibleCount++
    }
  })
  const emptyEl = document.querySelector('[data-app-layer-empty]')
  if (emptyEl) {
    emptyEl.hidden = visibleCount > 0
  }
}
