// The admin side of the fixture plugin: it provides the page it registered on the server, through
// the Micelio admin plugin's `apis` (docs/plugins/extension-points.md).
import { createElement } from 'react'

const FixturePage = () => createElement('h1', null, 'Fixture page content')

export default {
  register(app) {
    app.registerPlugin({ id: 'extension-fixture', name: 'extension-fixture' })
  },
  bootstrap(app) {
    app
      .getPlugin('micelio')
      .apis.registerPage('fixture-page', async () => ({ default: FixturePage }))
  },
  async registerTrads() {
    return []
  },
}
