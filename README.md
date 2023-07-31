# credential-registry-publish-action

A GitHub action that may be used to publish open data published in CTDL format to the Credential Registry by Credential Engine.

## Development Status

- [ ] Create `/src` with TypeScript source, `/lib` for destination builds, and `/dist` for committed packaged release versions of the action.
- [ ] Document expected node version `18` (current LTS version) in `.nvmrc` and Action configuration.
- [ ] Use Vercel's `ncc` tool (with `--licenses` flag) to package up dependency modules into a single file for distribution.
- [ ] Add `.prettierrc.json` etc. for code formatting.
- [ ] Tune `.gitignore`
- [ ] Create `/.action.yml` for GitHub Action metadata.
- [ ] Document inputs and environment secrets & variables for the action
- [ ] Implementer can configure one or more URLs to be processed.
- [ ] Implementer can configure an API key to be used for publishing.
- [ ] Implementer can configure a default organization to be used for publishing.
- [ ] Can import a Credential from a URL.
- [ ] Can import a LearningProgram from a URL.
- [ ] Set up tests to be run with test command for ensuring continued function of the action across pull requests and other future maintenance.
- [ ] Move repo to CE Organization
- [ ] Publish action to GitHub Marketplace

## Documentation and notes

This repository contains one GitHub Action using a NodeJS runtime. It roughly follows documentation at [GitHub](https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action) except that it uses a TypeScript source.
