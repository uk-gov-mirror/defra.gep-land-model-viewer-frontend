import { datasetForLayer } from '../../../../config/layers.js'
import { UNKNOWN_LAYER_LABEL } from '../../constants.js'
import { getSourceUrl, getVisibleWmsLayers } from '../../datasets/layers/wms.js'
import { hasVisibleFill, hasVisibleStroke } from '../../datasets/style-config.js'

function stylesForKey (styleConfig) {
  return [...styleConfig.classes, styleConfig.default]
    .filter(definition => hasVisibleFill(definition) || hasVisibleStroke(definition))
}

function getVisibleStyleEntries (map, datasets) {
  const visibleDatasets = map.getLayers().getArray()
    .filter(layer => layer.getVisible())
    .map(layer => datasetForLayer(layer, datasets))
    .filter(dataset => dataset?.source?.styleConfig)

  // Detail and overview layers map to the same dataset.
  return [...new Set(visibleDatasets)]
    .map(dataset => ({
      label: dataset.label,
      styles: stylesForKey(dataset.source.styleConfig)
    }))
    .filter(entry => entry.styles.length)
}

export function getKeyEntries (map, datasets) {
  const wmsEntries = getVisibleWmsLayers(map).map(layer => {
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

  return [...getVisibleStyleEntries(map, datasets), ...wmsEntries]
}
