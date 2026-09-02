import { getKeyEntries } from './key-entries.js'
import { hasVisibleStroke } from '../../datasets/style-config.js'

const MINIMUM_SWATCH_STROKE_WIDTH = 2

function WmsLegend ({ baseUrl, name }) {
  const label = name.replaceAll('_', ' ')
  const src = `${baseUrl}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=${encodeURIComponent(name)}&FORMAT=image/png`

  return (
    <div className='app-map__key-legend-row'>
      <span className='govuk-body-s govuk-!-margin-bottom-0'>{label}</span>
      <img className='app-map__key-legend' src={src} alt={`Legend for ${label}`} crossOrigin='anonymous' />
    </div>
  )
}

/** @param {number[]} colour */
function colourFor (colour) {
  const [red, green, blue, alpha] = colour

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function StyleLegend (definition) {
  const { fill = [0, 0, 0, 0], label, stroke } = definition
  const swatchStyle = {
    backgroundColor: colourFor(fill),
    ...(hasVisibleStroke(definition)
      ? {
          borderColor: colourFor(stroke.color),
          borderWidth: `${Math.max(stroke.width, MINIMUM_SWATCH_STROKE_WIDTH)}px`
        }
      : {})
  }

  return (
    <li className='app-map__key-style-row'>
      <span className='app-map__key-style-swatch' style={swatchStyle} aria-hidden='true' />
      <span className='govuk-body-s govuk-!-margin-bottom-0'>{label}</span>
    </li>
  )
}

export function KeyPanel ({ mapProvider, pluginConfig }) {
  const keyEntries = getKeyEntries(mapProvider.map, pluginConfig.datasets)

  return (
    <div className='app-map__key-panel'>
      {keyEntries.length
        ? (
          <div className='app-map__key-grid'>
            {keyEntries.map(({ label, layerNames, baseUrl, styles }) => (
              <div className='app-map__key-entry' key={baseUrl ? `${baseUrl}:${layerNames.join(',')}` : `style:${label}`}>
                <h3 className='govuk-heading-xs govuk-!-margin-bottom-1'>{label}</h3>
                {styles
                  ? (
                    <ul className='app-map__key-styles'>
                      {styles.map((style, index) => <StyleLegend {...style} key={`${style.label}:${index}`} />)}
                    </ul>
                    )
                  : (
                    <div className='app-map__key-legends'>
                      {layerNames.map(name => <WmsLegend baseUrl={baseUrl} name={name} key={name} />)}
                    </div>
                    )}
              </div>
            ))}
          </div>
          )
        : <p className='govuk-body govuk-!-margin-bottom-0'>Enable data layers to view the key.</p>}
    </div>
  )
}
