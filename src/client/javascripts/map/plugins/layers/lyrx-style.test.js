import { vi, describe, test, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileLyrxStyle, loadLyrxStyle } from './lyrx-style.js'

const LYRX_URL = 'https://example.com/habitats.lyrx'
const MIN_SCALE = 106237.930732
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

const rgb = (values) => ({ type: 'CIMRGBColor', values })

const solidFill = (values = [194, 158, 215, 100]) => ({
  type: 'CIMSolidFill',
  enable: true,
  color: rgb(values)
})

const solidStroke = (overrides = {}) => ({
  type: 'CIMSolidStroke',
  enable: true,
  capStyle: 'Round',
  joinStyle: 'Round',
  width: 2,
  color: rgb([0, 92, 230, 100]),
  ...overrides
})

function symbolRef (type, symbolLayers) {
  return {
    type: 'CIMSymbolReference',
    symbol: { type, symbolLayers }
  }
}

function layerDefinition (renderer, overrides = {}) {
  return {
    type: 'CIMLayerDocument',
    version: '3.4.0',
    layerDefinitions: [{
      type: 'CIMFeatureLayer',
      name: 'Test habitats',
      renderer,
      ...overrides
    }]
  }
}

function uniqueValueClass (label, symbolLayers, fieldValues = [label]) {
  return {
    type: 'CIMUniqueValueClass',
    label,
    symbol: symbolRef('CIMPolygonSymbol', symbolLayers),
    values: fieldValues.map(value => ({ type: 'CIMUniqueValue', fieldValues: [value] })),
    visible: true
  }
}

function uniqueValueClassesFixture (classes, overrides = {}, renderer = {}) {
  return layerDefinition({
    type: 'CIMUniqueValueRenderer',
    fields: ['A_pred'],
    groups: [{ type: 'CIMUniqueValueGroup', classes }],
    ...renderer
  }, overrides)
}

function uniqueValueFixture (symbolLayers = [solidFill()], overrides = {}) {
  return uniqueValueClassesFixture([uniqueValueClass('Bog', symbolLayers)], overrides)
}

function simpleRendererFixture (symbolType, symbolLayers) {
  return layerDefinition({
    type: 'CIMSimpleRenderer',
    symbol: symbolRef(symbolType, symbolLayers)
  })
}

function stubLyrxResponse (body, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status: ok ? 200 : 404,
    json: async () => body
  })))
}

describe('#compileLyrxStyle', () => {
  test('compiles a unique value renderer keyed on the cased field name', async () => {
    const { style } = await compileLyrxStyle(uniqueValueFixture())

    expect(style['fill-color']).toEqual([
      'case',
      ['==', ['get', 'A_pred'], 'Bog'], '#c29ed7',
      TRANSPARENT
    ])
  })

  test('lowercases the field name when the dataset asks for it', async () => {
    const { style } = await compileLyrxStyle(uniqueValueFixture(), { lowercaseFields: true })

    expect(style['fill-color']).toEqual([
      'case',
      ['==', ['get', 'a_pred'], 'Bog'], '#c29ed7',
      TRANSPARENT
    ])
  })

  test('carries a polygon outline through as stroke properties', async () => {
    const { style } = await compileLyrxStyle(uniqueValueFixture([solidStroke(), solidFill()]))

    expect(style['fill-color']).toEqual(['case', ['==', ['get', 'A_pred'], 'Bog'], '#c29ed7', TRANSPARENT])
    expect(style['stroke-color']).toEqual(['case', ['==', ['get', 'A_pred'], 'Bog'], '#005ce6', TRANSPARENT])
    expect(style['stroke-width'][2]).toBeCloseTo(2.667, 3)
  })

  test('omits a property branch for classes that do not set it', async () => {
    const { style } = await compileLyrxStyle(uniqueValueClassesFixture([
      uniqueValueClass('Bog', [solidStroke(), solidFill()]),
      uniqueValueClass('Fen', [solidFill([100, 120, 140, 100])])
    ]))

    expect(style['fill-color']).toEqual([
      'case',
      ['==', ['get', 'A_pred'], 'Bog'], '#c29ed7',
      ['==', ['get', 'A_pred'], 'Fen'], '#64788c',
      TRANSPARENT
    ])
    expect(style['stroke-color']).toEqual([
      'case', ['==', ['get', 'A_pred'], 'Bog'], '#005ce6', TRANSPARENT
    ])
  })

  test('falls back to the renderer default symbol for unmatched values', async () => {
    const { style } = await compileLyrxStyle(uniqueValueClassesFixture(
      [uniqueValueClass('Bog', [solidFill()])],
      {},
      {
        useDefaultSymbol: true,
        defaultSymbol: symbolRef('CIMPolygonSymbol', [solidFill([205, 233, 247, 100])])
      }
    ))

    expect(style['fill-color']).toEqual([
      'case',
      ['==', ['get', 'A_pred'], 'Bog'], '#c29ed7',
      '#cde9f7'
    ])
  })

  test('keeps the transparent fallback when the renderer disables its default symbol', async () => {
    const { style } = await compileLyrxStyle(uniqueValueClassesFixture(
      [uniqueValueClass('Bog', [solidFill()])],
      {},
      {
        useDefaultSymbol: false,
        defaultSymbol: symbolRef('CIMPolygonSymbol', [solidFill([205, 233, 247, 100])])
      }
    ))

    expect(style['fill-color'].at(-1)).toBe(TRANSPARENT)
  })

  test('maps a class covering several values onto any', async () => {
    const { style } = await compileLyrxStyle(uniqueValueClassesFixture([
      uniqueValueClass('Wet', [solidFill()], ['Bog', 'Fen'])
    ]))

    expect(style['fill-color']).toEqual([
      'case',
      ['any', ['==', ['get', 'A_pred'], 'Bog'], ['==', ['get', 'A_pred'], 'Fen']], '#c29ed7',
      TRANSPARENT
    ])
  })

  test('throws on a symbolizer kind it does not support', async () => {
    const lyrx = simpleRendererFixture('CIMLineSymbol', [solidStroke()])

    await expect(compileLyrxStyle(lyrx)).rejects.toThrow('Unsupported symbolizer kind Line')
  })

  test('applies a simple renderer unconditionally', async () => {
    const { style } = await compileLyrxStyle(simpleRendererFixture('CIMPolygonSymbol', [solidFill()]))

    expect(style).toEqual({ 'fill-color': '#c29ed7' })
  })

  test('folds a partly transparent supplier colour into rgba', async () => {
    const { style } = await compileLyrxStyle(uniqueValueFixture([solidFill([194, 158, 215, 50])]))

    expect(style['fill-color'][2]).toBe('rgba(194,158,215,0.5)')
  })

  test('converts the layer minScale into a maximum resolution', async () => {
    const { maxResolution } = await compileLyrxStyle(uniqueValueFixture([solidFill()], { minScale: MIN_SCALE }))

    expect(maxResolution).toBeCloseTo(28.109, 3)
  })

  test('leaves maxResolution unset when the layer file states no minScale', async () => {
    const { maxResolution } = await compileLyrxStyle(uniqueValueFixture())

    expect(maxResolution).toBeUndefined()
  })

  test.each([
    ['living-england'],
    ['ancient-woodland'],
    ['agricultural-land-classification'],
    ['crop-map-of-england-2020'],
    ['wood-pasture-and-parkland'],
    ['flood-zones-2-3-rivers-and-sea']
  ])('%s compiles to a stable flat style', async (name) => {
    const lyrx = JSON.parse(readFileSync(new URL(`./fixtures/${name}.lyrx`, import.meta.url), 'utf8'))

    await expect(compileLyrxStyle(lyrx)).resolves.toMatchSnapshot()
  })
})

describe('#loadLyrxStyle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('fetches the layer file and compiles it', async () => {
    stubLyrxResponse(uniqueValueFixture())

    const { style } = await loadLyrxStyle(LYRX_URL, { lowercaseFields: true })

    expect(global.fetch).toHaveBeenCalledWith(LYRX_URL)
    expect(style['fill-color'][1]).toEqual(['==', ['get', 'a_pred'], 'Bog'])
  })

  test('throws when the layer file cannot be fetched', async () => {
    stubLyrxResponse(null, false)

    await expect(loadLyrxStyle(LYRX_URL)).rejects.toThrow(/404/)
  })
})
