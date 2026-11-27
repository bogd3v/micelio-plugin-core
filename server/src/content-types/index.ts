import { withEditorial } from '../editorial'
import { withSiteScope } from '../site-scope'
import blockSetting from './block-setting/schema.json'
import category from './category/schema.json'
import pageTemplate from './page-template/schema.json'
import previewCredential from './preview-credential/schema.json'
import redirect from './redirect/schema.json'
import reusableBlock from './reusable-block/schema.json'
import site from './site/schema.json'
import tag from './tag/schema.json'
import themeActivation from './theme-activation/schema.json'
import transfer from './transfer/schema.json'

export default {
  site: { schema: site },
  'block-setting': { schema: withSiteScope(blockSetting) },
  category: { schema: withSiteScope(category) },
  tag: { schema: withSiteScope(tag) },
  'page-template': { schema: withSiteScope(pageTemplate) },
  redirect: { schema: withSiteScope(redirect) },
  'reusable-block': { schema: withSiteScope(withEditorial(reusableBlock)) },
  'preview-credential': { schema: withSiteScope(previewCredential) },
  transfer: { schema: withSiteScope(transfer) },
  'theme-activation': { schema: withSiteScope(themeActivation) },
}
