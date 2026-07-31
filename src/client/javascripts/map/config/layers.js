export const OVERLAY_Z_INDEX = 100

const LAYER_ID_PREFIX = 'gep-'

/** @param {{ id: string }} dataset */
export function layerIdFor (dataset) {
  return `${LAYER_ID_PREFIX}${dataset.id}`
}

/**
 * @param {import('ol/layer/Layer').default} layer
 * @param {any[]} datasets
 */
export function datasetForLayer (layer, datasets) {
  const layerId = layer.get('id')

  return datasets.find(dataset => layerIdFor(dataset) === layerId)
}
