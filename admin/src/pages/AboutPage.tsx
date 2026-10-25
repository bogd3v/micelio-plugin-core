import { Typography } from '@strapi/design-system'
import { Layouts, Page } from '@strapi/strapi/admin'

import { useMessages } from '../messages'

/** About Micelio: what the plugin is. Open to every admin user, since it shows no configuration. */
export default function AboutPage() {
  const { t } = useMessages()
  return (
    <Page.Main>
      <Page.Title>{t('about.title')}</Page.Title>
      <Layouts.Header title={t('about.title')} subtitle={t('about.subtitle')} />
      <Layouts.Content>
        <Typography>{t('about.body')}</Typography>
      </Layouts.Content>
    </Page.Main>
  )
}
