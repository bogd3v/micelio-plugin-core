// The admin side of the fixture plugin: it provides the page and the site panel it registered on the server, through
// the Micelio admin plugin's `apis` (docs/plugins/extension-points.md).
import { createElement } from 'react'

const FixturePage = () => createElement('h1', null, 'Fixture page content')

// The panel of the `fixture-profile` site section: it shows the section's data and whether the
// caller may write. `window.fixtureProfilePanelLoads` counts the loads of its module, so a suite
// can tell that a role without the section's permission never loaded it.
const ProfilePanel = ({ site, section, canWrite }) =>
  createElement(
    'p',
    null,
    `Profile panel of ${site.slug}: handle ${section ? section.handle : 'none'}, ` +
      (canWrite ? 'editable' : 'read only')
  )

export default {
  register(app) {
    app.registerPlugin({ id: 'extension-fixture', name: 'extension-fixture' })
  },
  bootstrap(app) {
    const { apis } = app.getPlugin('micelio')
    apis.registerPage('fixture-page', async () => ({ default: FixturePage }))
    apis.registerSitePanel('extension-fixture.profile', async () => {
      window.fixtureProfilePanelLoads = (window.fixtureProfilePanelLoads ?? 0) + 1
      return { default: ProfilePanel }
    })
    // `extension-fixture.unpanelled`, the panel of the second section, is never registered.
  },
  async registerTrads() {
    return []
  },
}
