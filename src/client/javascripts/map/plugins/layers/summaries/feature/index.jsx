import { LandSummaryView } from '../components/LandSummaryView.jsx'
import { toFeatureRecord } from './data.js'

/** @type {import('../../data-layers/hits.jsx').HitOptions} */
export const featureHitOptions = {
  label: () => 'OS feature',
  toDetails: ([properties], layer) => toFeatureRecord(
    /** @type {import('./data.js').ParcelProperties} */ (properties),
    /** @type {import('./api.js').FeatureSource} */ (layer.source).sources
  ),
  render: details => <LandSummaryView record={details} />
}
