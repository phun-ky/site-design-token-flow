# Roadmap

What Design Token Flow intends to do, and not do, from November 2026 to
November 2027. It's a plan, not a promise: priorities can change, and changes to
this file are made in pull requests like any other. Individual pieces of work
are tracked as
[GitHub issues](https://github.com/phun-ky/site-design-token-flow/issues).

## Shipped

### Published links for Tokens Studio

The Tokens Studio plugin for Figma can sync tokens from a URL, read only, and
shows when they have changed. Sign in with GitHub or Google in the playground
and publish the tokens you edit as such a URL, in Tokens Studio's format, so
designers pull your latest tokens into Figma. Signing in with Figma follows
once Figma approves the app.

- **Opt in.** The site works as before without signing in, and nothing leaves
  your browser until you publish a link. Visitors who don't sign in load
  nothing from other hosts.
- **What is stored:** the tokens you publish, readable by anyone with the link,
  and your account's id and email from GitHub, Google or Figma. It is kept with
  [Supabase](https://supabase.com), in the EU (Ireland). You can unpublish a
  link, or delete your account and everything published with it.
- **Up to 3 links**, one per token document in the playground. Once a link is
  published, your edits update it as you make them, and a link published on
  another device can be opened by name.
- **Documents** can be deleted, with undo for 10 seconds, and edits with
  problems can be reverted to the last version without them.

The steps were tracked in
[#148](https://github.com/phun-ky/site-design-token-flow/issues/148), and the
[security policy](SECURITY.md) describes what is stored and how.

## Planned

### The pill renderer as its own package

`src/tokens/`, which reads DTCG 2025.10 token files, validates them and renders
tokens as pills, becomes its own npm package. It is kept self-contained for
that: nothing in it imports the site's code, and the site uses it only through
its public API. The steps, and the decisions still to make (its name, and with
it possibly the `$extensions` key), are in
[its README](src/tokens/README.md#extracting-into-a-package). The deprecated
package `@phun-ky/design-token-flow` points to it once it exists.

### Project health

- **OpenSSF Scorecard and Best Practices:** a Scorecard workflow, and the
  passing badge
  ([#21](https://github.com/phun-ky/site-design-token-flow/issues/21)).
- **A second maintainer**, so that pull requests get a review from someone other
  than the author and access to the project doesn't rest on one person; see
  [governance](GOVERNANCE.md#continuity).

## Proposals, not decided

Ideas that fit the project but are not decided. Each would be discussed in an
issue first.

- **A desktop app:** the site wrapped in Electron, for use offline. The site is
  built with relative paths so that it can be.
- **Your own token file in the flow view:** open or drop a `*.tokens.json` file
  to see its flow, as the playground does for single tokens. It would stay in
  the browser, like the playground's.
- **More than 3 published links**, on a paid plan
  ([#150](https://github.com/phun-ky/site-design-token-flow/issues/150)).
- **Editing tokens in Figma and syncing them back** to the site, with Tokens
  Studio's Generic Versioned Storage.

## Not planned

- **Storing tokens you haven't published.** What you paste into the playground
  stays in your browser until you publish a link.
- **Collecting data.** The site doesn't track visitors, and stores nothing
  about you beyond the account you sign in with.
- **Runtime dependencies without discussion.** A new library in the site is
  discussed in an issue first; see the [security policy](SECURITY.md#dependencies).
