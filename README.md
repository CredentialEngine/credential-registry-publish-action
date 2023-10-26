# credential-registry-publish-action

A GitHub action that may be used to push linked open data that an organization
offers on their own website in CTDL format to the Credential Registry by
Credential Engine.

This tool enables organizations to publish a wide variety of open data about
their credentials, learning opportunities, and more, so that it can be
accessible both on organizational websites and discoverable in the Credential
Engine Registry via [CredentialFinder.org](https://credentialfinder.org).

**This tool is intended for developers or other technical staff**, probably by
those implementing the open data publishing strategy. Other methods of
publishing data to the Registry are available for non-developers, including
input forms and CSV uploads on the [Credential Engine
website](https://apps.credentialengine.org/publisher).

## Get assistance and report problems

Reach out to Credential Engine staff via
[email](mailto:info@credentialengine.org?subject=Credential%20Registry%20Publish%20Action)
if you need help using the tool. To report issues, you can use email or file
them on GitHub at the
[credential-registry-publish-action](https://github.com/credentialengine/credential-registry-publish-action/issues)
repository. This software is open source and open for contributions and
improvements.

### Developer Notes

This repository contains one GitHub Action using a NodeJS runtime. It roughly
follows the approach at [Creating a JavaScript
Action](https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action)
except that it uses a TypeScript source, compiled to JavaScript with `ncc`.
Contributors, see some [additional documentation on using the Actions Toolkit in
Typescript](https://github.com/actions/typescript-action), covering how to use
test mocks.
