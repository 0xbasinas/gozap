/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JavaScript file, loaded by astro.config.mjs */
// Two greyscale code themes (dark and light) for the docs: tokens differ by brightness and weight, not by hue, so
// code blocks match the black, white and grey of the rest of the site.
function rules(c) {
  return [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: c.dim, fontStyle: 'italic' }
    },
    {
      scope: [
        'keyword',
        'storage',
        'keyword.control',
        'support.function',
        'entity.name.function',
        'variable.function'
      ],
      settings: { foreground: c.strong, fontStyle: 'bold' }
    },
    {
      scope: ['string', 'constant.numeric', 'constant.language', 'constant.character'],
      settings: { foreground: c.mid }
    },
    {
      scope: [
        'entity.name.tag',
        'support.type.property-name',
        'variable.other.property',
        'meta.object-literal.key'
      ],
      settings: { foreground: c.strong }
    },
    { scope: ['punctuation', 'meta.brace', 'keyword.operator'], settings: { foreground: c.dim } },
    { scope: ['variable.parameter', 'variable.other.readwrite'], settings: { foreground: c.text } }
  ]
}

export const monoDark = {
  name: 'mono-dark',
  type: 'dark',
  colors: { 'editor.background': '#171717', 'editor.foreground': '#d4d4d4' },
  settings: rules({ strong: '#fafafa', text: '#d4d4d4', mid: '#a3a3a3', dim: '#737373' })
}

export const monoLight = {
  name: 'mono-light',
  type: 'light',
  colors: { 'editor.background': '#fafafa', 'editor.foreground': '#262626' },
  settings: rules({ strong: '#0a0a0a', text: '#262626', mid: '#525252', dim: '#8a8a8a' })
}
