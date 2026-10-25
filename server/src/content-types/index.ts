import { withSiteScope } from '../site-scope'
import previewCredential from './preview-credential/schema.json'
import site from './site/schema.json'

export default {
  site: { schema: site },
  'preview-credential': { schema: withSiteScope(previewCredential) },
}
