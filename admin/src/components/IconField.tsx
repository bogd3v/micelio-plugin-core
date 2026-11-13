import { useIntl } from 'react-intl'

import { IconPicker } from './IconPicker'

interface MessageDescriptor {
  id?: string
  defaultMessage?: string
}

interface IconFieldProps {
  name: string
  value?: string | null
  /** The Content Manager's label and hint, as text. */
  label?: string
  hint?: string
  /** What the field was registered with, as message descriptors; the form's text wins. */
  intlLabel?: MessageDescriptor
  description?: MessageDescriptor | null
  error?: string
  required?: boolean
  disabled?: boolean
  onChange: (event: { target: { name: string; value: string | null; type: string } }) => void
}

/**
 * The input the Content Manager shows for a field `micelio.icon`: the picker, with the form's
 * label, hint and error. The value is the stored name or `null`.
 *
 * @remarks
 * The form passes the label and the hint as text (`label`, `hint`); a descriptor with no `id` is
 * never formatted, since `react-intl` throws on it and the whole edit view with it.
 */
export function IconField(props: IconFieldProps) {
  const { formatMessage } = useIntl()
  const described = (descriptor: MessageDescriptor | null | undefined): string | undefined =>
    descriptor?.id
      ? formatMessage({ id: descriptor.id, defaultMessage: descriptor.defaultMessage })
      : undefined
  return (
    <IconPicker
      id={props.name}
      label={props.label || described(props.intlLabel) || props.name}
      hint={props.hint || described(props.description)}
      value={typeof props.value === 'string' && props.value !== '' ? props.value : null}
      error={props.error}
      required={props.required}
      disabled={props.disabled}
      onChange={(value) => props.onChange({ target: { name: props.name, value, type: 'string' } })}
    />
  )
}

export default IconField
