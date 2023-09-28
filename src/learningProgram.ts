import * as core from "@actions/core";
import fetch from "node-fetch-cache";
import {
  RegistryConfig,
  AssistantBaseUrls,
  RegistryBaseUrls,
  DocumentMetadata,
} from "./types";

/*
https://credreg.net/registry/policy#learningprogram
Learning Program required properties and whether they would be a linked node that would require spidered fetching

Life Cycle Status Type `ceterms:lifeCycleStatusType` - no
Name `ceterms:name` - no
Description `ceterms:description` - no
Subject Webpage `ceterms:subjectWebpage` - no
CTID `ceterms:ctid` - no
InLanguage `ceterms:inLanguage` - no

Recommended properties:
Keyword `ceterms:keyword`

Other properties in range:
*/

export const publishLearningProgram = async (
  learningProgramGraph: any,
  metadata: DocumentMetadata,
  registryConfig: RegistryConfig
) => {
  const ctid = learningProgramGraph["@graph"][0]["ceterms:ctid"];
  const graphId = `${registryConfig.registryBaseUrl}/graph/${ctid}`;
  core.info(
    `Validating learning program from ${metadata.url} with ctid: ${ctid}...`
  );

  const validationUrl = `${
    AssistantBaseUrls[registryConfig.registryEnv]
  }/learningprogram/validategraph`;

  const validateResponse = await fetch(validationUrl, {
    method: "POST",
    headers: {
      Authorization: `ApiToken ${registryConfig.registryApiKey}`,
    },
    body: JSON.stringify({
      PublishForOrganizationIdentifier: registryConfig.registryOrgCtid,
      GraphInput: {
        ...learningProgramGraph,
        "@id": graphId,
      },
    }),
  });

  if (!validateResponse.ok) {
    core.error(
      `Error validating learning program: ${validateResponse.statusText}`
    );
    return;
  }

  const learningProgramJson = await validateResponse.json();

  if (learningProgramJson["Successful"] == false) {
    core.error(
      `Error publishing learning program ${metadata.url}: ${learningProgramJson["Messages"]}`
    );
    return;
  }
  core.info(`Validated learning program structure.`);

  core.info(`Publishing learning program ${graphId} ...`);
  const publishUrl = `${
    AssistantBaseUrls[registryConfig.registryEnv]
  }/learningprogram/publishgraph`;
  const publishResponse = await fetch(publishUrl, {
    method: "POST",
    headers: {
      Authorization: `ApiToken ${registryConfig.registryApiKey}`,
    },
    body: JSON.stringify({
      PublishForOrganizationIdentifier: registryConfig.registryOrgCtid,
      Publish: true, // avoid error in node-fetch-cache
      GraphInput: {
        ...learningProgramGraph,
        "@id":
          `${registryConfig.registryBaseUrl}/graph/` +
          learningProgramGraph["@graph"][0]["ceterms:ctid"],
      },
    }),
  });

  if (!publishResponse.ok) {
    core.error(
      `Response Not OK. Error publishing learning program graph ${graphId}: ${publishResponse.statusText}`
    );
    return;
  }

  const publishJson = await publishResponse.json();

  if (publishJson["Successful"] == false) {
    core.error(`Error publishing learning program: ${publishJson["Messages"]}`);
    return;
  }

  core.info(`Published learning program ${graphId} with CTID ${ctid}.`);
};
