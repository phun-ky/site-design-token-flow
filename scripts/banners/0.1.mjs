// Content of the release banners for 0.1. Copy this file for the next release
// (e.g. 1.0.mjs) and run: npm run banners -- 1.0
export default {
  slug: 'v0',
  pill: 'Release 0.1 · November 2026',
  title: ['Every token a pill,', { accent: 'every alias a line' }],
  body: 'Design Token Flow draws DTCG 2025.10 tokens and the tokens they reference. Load your own DTCG or Tokens Studio files in the playground, then export them or publish them as a link.',
  // The diagram: pills of the example token file, src/assets/data, from an
  // alias down to the base colour it ends at, as the site renders them
  tokens: [
    'color-background-button-primary',
    'color-cta',
    'color-accent-blue',
    'color-base-blue-100'
  ]
};
