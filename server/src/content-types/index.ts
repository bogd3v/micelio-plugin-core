import { withSiteScope } from '../site-scope'
import category from './category/schema.json'
import previewCredential from './preview-credential/schema.json'
import site from './site/schema.json'
import tag from './tag/schema.json'
import transfer from './transfer/schema.json'

export default {
  site: { schema: site },
  category: { schema: withSiteScope(category) },
  tag: { schema: withSiteScope(tag) },
  'preview-credential': { schema: withSiteScope(previewCredential) },
  transfer: { schema: withSiteScope(transfer) },
}
