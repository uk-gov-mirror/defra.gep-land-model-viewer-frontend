import { convert } from 'geostyler-lyrx-parser/dist/toGeostyler.js'
import { processSymbolReference } from 'geostyler-lyrx-parser/dist/processSymbolReference.js'
import { asArray, asString } from 'ol/color.js'

const INCHES_PER_METRE = 39.37
const ESRI_DPI = 96
const SCALE_TO_RESOLUTION = INCHES_PER_METRE * ESRI_DPI

const TRANSPARENT = 'rgba(0, 0, 0, 0)'

const FALLBACKS = {
  'fill-color': TRANSPARENT,
  'stroke-color': TRANSPARENT,
  'stroke-width': 0
}

/**
 * Fetches an ArcGIS Pro layer file and compiles it.
 *
 * @param {string} url Layer file (.lyrx) URL
 * @param {object} [options] As compileLyrxStyle
 * @returns {ReturnType<typeof compileLyrxStyle>}
 */
export async function loadLyrxStyle (url, options) {
  return compileLyrxStyle(await fetchLyrx(url), options)
}

/**
 * Compiles an ArcGIS Pro layer file's renderer into an OpenLayers flat style
 * for the WebGL renderer.
 *
 * @param {object} lyrx Parsed layer file (.lyrx) document
 * @param {object} [options]
 * @param {boolean} [options.lowercaseFields] Lowercase the field names the layer
 *   file names, for data exported with lowercased columns.
 * @returns {Promise<{
 *   style: import('ol/style/flat.js').FlatStyle,
 *   maxResolution: number|undefined
 * }>}
 */
export async function compileLyrxStyle (lyrx, { lowercaseFields = false } = {}) {
  const options = { toLowerCase: lowercaseFields }
  const [geostylerStyle] = await convert(lyrx, options)
  const fallbacks = await fallbacksFor(lyrx, options)

  return { style: flatStyleFor(geostylerStyle, fallbacks), maxResolution: maxResolutionFor(lyrx) }
}

async function fallbacksFor (lyrx, options) {
  // The parser only reads defaultSymbol when a renderer has no groups, so a classified
  // layer never reaches it.
  const renderer = lyrx.layerDefinitions?.[0]?.renderer
  if (!renderer?.useDefaultSymbol) {
    return FALLBACKS
  }

  const symbolizers = await processSymbolReference(renderer.defaultSymbol, options)

  return Object.assign({}, FALLBACKS, ...symbolizers.map(flatPropertiesFor))
}

function flatStyleFor (geostylerStyle, fallbacks) {
  const { rules } = geostylerStyle
  const properties = rules.map((rule) => Object.assign({}, ...rule.symbolizers.map(flatPropertiesFor)))

  // Simple renderers carry no filter, so the one style applies unconditionally.
  if (!rules.some((rule) => rule.filter)) {
    return properties[0] ?? {}
  }

  const style = {}
  for (const key of new Set(properties.flatMap(Object.keys))) {
    /** @type {import('ol/expr/expression.js').EncodedExpression[]} */
    const branches = ['case']

    properties.forEach((values, index) => {
      const { filter } = rules[index]
      if (filter && key in values) {
        branches.push(predicateFor(filter), values[key])
      }
    })
    branches.push(fallbacks[key])

    style[key] = branches
  }

  return style
}

// GeoStyler and OpenLayers share the comparison operators, so only the logical
// ones need mapping. A comparison names its field, which becomes a get.
const LOGICAL_OPERATORS = { '&&': 'all', '||': 'any', '!': '!' }

function predicateFor (filter) {
  const [operator, ...operands] = filter
  if (operator in LOGICAL_OPERATORS) {
    return [LOGICAL_OPERATORS[operator], ...operands.map(predicateFor)]
  }

  const [field, value] = operands

  return [operator, ['get', field], value]
}

function flatPropertiesFor (symbolizer) {
  if (symbolizer.kind !== 'Fill') {
    throw new Error(`Unsupported symbolizer kind ${symbolizer.kind}`)
  }

  if (symbolizer.outlineColor) {
    return {
      'stroke-color': colourFor(symbolizer.outlineColor, symbolizer.outlineOpacity),
      'stroke-width': symbolizer.outlineWidth
    }
  }

  if (!symbolizer.color) {
    throw new Error('Unsupported fill symbolizer without a colour')
  }

  return { 'fill-color': colourFor(symbolizer.color, symbolizer.fillOpacity) }
}

function colourFor (colour, opacity) {
  if (opacity === undefined || opacity === 1) {
    return colour
  }

  const [red, green, blue] = asArray(colour)
  return asString([red, green, blue, opacity])
}

async function fetchLyrx (url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not fetch layer file ${url}: ${response.status}`)
  }

  return response.json()
}

function maxResolutionFor (lyrx) {
  const minScale = lyrx.layerDefinitions?.[0]?.minScale
  if (!minScale) {
    return undefined
  }

  return minScale / SCALE_TO_RESOLUTION
}
