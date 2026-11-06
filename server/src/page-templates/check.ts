import type { Core, UID } from '@strapi/strapi'
import { populateOf } from '../block-settings/populate'
import { TEMPLATE_SAMPLES_ATTRIBUTE } from '../constants/page-settings'
import { hasPageSettings } from '../page-settings'
import { findSampleText, type AttributesOf, type SampleTextFound } from './rules'

/**
 * The blocks of an entry's draft that still hold a sample text of the template it was created from.
 *
 * @remarks
 * Reads the sample texts the page recorded (`templateSamples`), then every dynamic zone of the draft;
 * a type without page settings, and a page made without a template, are not read at all. A text the
 * editor replaced is no longer a sample, so the page publishes once none is left.
 */
export async function findSampleTextIn(
  strapi: Core.Strapi,
  target: { uid: UID.ContentType; documentId: string; locale?: string | null }
): Promise<(SampleTextFound & { zone: string })[]> {
  const model = strapi.contentType(target.uid)
  if (!hasPageSettings(model)) return []
  const attributesOf: AttributesOf = (uid) =>
    strapi.components[uid as UID.Component]?.attributes as ReturnType<AttributesOf>
  const draft = (await strapi.documents(target.uid).findOne({
    documentId: target.documentId,
    locale: target.locale ?? undefined,
    status: 'draft',
    populate: populateOf(
      model.attributes,
      (component) => attributesOf(component) as Record<string, unknown> | undefined
    ),
  } as never)) as Record<string, unknown> | null
  const samples = draft?.[TEMPLATE_SAMPLES_ATTRIBUTE]
  if (!Array.isArray(samples) || samples.length === 0) return []
  const texts = samples.filter((sample): sample is string => typeof sample === 'string')
  return Object.entries(model.attributes as Record<string, { type?: string }>)
    .filter(([, attribute]) => attribute.type === 'dynamiczone')
    .flatMap(([name]) => {
      const zone = draft?.[name]
      return Array.isArray(zone)
        ? findSampleText(attributesOf, zone, texts).map((found) => ({ ...found, zone: name }))
        : []
    })
}
