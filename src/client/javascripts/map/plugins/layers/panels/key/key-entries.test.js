import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'

vi.mock('../../datasets/layers/wms.js', () => ({
  getSourceUrl: vi.fn(() => '/wms'),
  getVisibleWmsLayers: vi.fn(() => [])
}))

const { getVisibleWmsLayers } = await import('../../datasets/layers/wms.js')
const { UNKNOWN_LAYER_LABEL } = await import('../../constants.js')
const { getKeyEntries } = await import('./key-entries.js')

const STYLE_CONFIG = {
  classes: [{ label: 'Bog', fill: [194, 158, 215, 1] }, {
    label: 'Outlined site',
    fill: [178, 102, 204, 1],
    stroke: { color: [112, 48, 135, 1], width: 1.25 }
  }, {
    label: 'Hidden class',
    fill: [255, 0, 0, 1],
    visible: false
  }, {
    label: 'Transparent class',
    fill: [0, 0, 0, 0]
  }]
}
const DATASETS = [{ id: 'flood', label: 'Flood Zones' }, {
  id: 'habitats',
  label: 'Habitats',
  source: { type: 'fgb', styleConfig: STYLE_CONFIG }
}]

function stubLayer (id, layerNames, visible = true) {
  return {
    get: key => key === 'id' ? id : undefined,
    getVisible: () => visible,
    getSource: () => ({ getParams: () => layerNames ? { LAYERS: layerNames } : {} })
  }
}

function stubMap (layers = []) {
  return /** @type {import('ol/Map').default} */ (/** @type {unknown} */ ({
    getLayers: () => ({ getArray: () => layers })
  }))
}

const map = stubMap()

beforeEach(() => {
  vi.mocked(getVisibleWmsLayers).mockReturnValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getKeyEntries', () => {
  test('lists every visible WMS layer', () => {
    vi.mocked(getVisibleWmsLayers).mockReturnValue([stubLayer('gep-flood', 'zone_2,zone_3')])

    expect(getKeyEntries(map, DATASETS)).toEqual([
      { label: 'Flood Zones', baseUrl: '/wms', layerNames: ['zone_2', 'zone_3'] }
    ])
    expect(getVisibleWmsLayers).toHaveBeenCalledWith(map)
  })

  test('leaves out a WMS layer without layer names', () => {
    vi.mocked(getVisibleWmsLayers).mockReturnValue([stubLayer('gep-flood')])

    expect(getKeyEntries(map, DATASETS)).toEqual([])
  })

  test('uses a generic label for an unrecognised layer', () => {
    vi.mocked(getVisibleWmsLayers).mockReturnValue([stubLayer('gep-mystery', 'x')])

    expect(getKeyEntries(map, DATASETS)[0].label).toBe(UNKNOWN_LAYER_LABEL)
  })

  test('lists styles once for a dataset with detail and overview layers', () => {
    const map = stubMap([stubLayer('gep-habitats'), stubLayer('gep-habitats-overview')])

    expect(getKeyEntries(map, DATASETS)).toEqual([{
      label: 'Habitats',
      styles: [{
        label: 'Bog',
        fill: [194, 158, 215, 1]
      }, {
        label: 'Outlined site',
        fill: [178, 102, 204, 1],
        stroke: { color: [112, 48, 135, 1], width: 1.25 }
      }]
    }])
  })

  test('leaves out a hidden operational dataset', () => {
    const map = stubMap([stubLayer('gep-habitats', undefined, false)])

    expect(getKeyEntries(map, DATASETS)).toEqual([])
  })

  test('includes a visible default style', () => {
    const datasets = [{
      id: 'peat',
      label: 'Peat depth',
      source: {
        type: 'cog',
        styleConfig: {
          classes: [{ label: 'Up to 20cm', fill: [204, 204, 255, 1] }],
          default: { label: 'Over 20cm', fill: [0, 0, 224, 1] }
        }
      }
    }]

    expect(getKeyEntries(stubMap([stubLayer('gep-peat')]), datasets)[0].styles).toEqual([
      { label: 'Up to 20cm', fill: [204, 204, 255, 1] },
      { label: 'Over 20cm', fill: [0, 0, 224, 1] }
    ])
  })
})
