import * as core from "@actions/core";
import { context } from "@actions/github";
import { httpClient } from "./http";

import { CredentialSubtypes } from "./credential";
import { arrayOf } from "./utils";
import {
  RegistryEnvironment,
  RegistryBaseUrls,
  RegistryConfig,
  AssistantBaseUrls,
} from "./types";
import {
  entityStore,
  extractGraphForEntity,
  processEntity,
  indexDocuments,
  getOrderedEntitiesToPublish,
} from "./graphs";
import {
  topLevelClassURIs,
  getClassMetadata,
  ClassMetadata,
  classIsDescendantOf,
} from "./ctdl";
import { get } from "http";
import { getPriority } from "os";

export const publishDocument = async (
  graphDocument: any & {
    "@context": "https://credreg.net/ctdl/schema/context/json";
    "@graph": any[];
  },
  registryConfig: RegistryConfig,
  classMetadata: ClassMetadata
): Promise<boolean> => {
  const ctid = graphDocument["@graph"][0]["ceterms:ctid"];
  const entityType = graphDocument["@graph"][0]["@type"];
  const graphId = `${registryConfig.registryBaseUrl}/graph/${ctid}`;

  core.info(`Publishing ${classMetadata.className} ${graphId} ...`);
  const publishUrl = `${AssistantBaseUrls[registryConfig.registryEnv]}${
    classMetadata.publishEndpoint
  }`;

  if (registryConfig.dryRun) {
    core.info(`Dry run: would publish to ${publishUrl}`);
    core.info(JSON.stringify(graphDocument, null, 2));
    return false;
  }

  core.info(`Publishing to ${publishUrl}`);
  const publishResponse = await httpClient.fetch(publishUrl, {
    method: "POST",
    headers: {
      Authorization: `ApiToken ${registryConfig.registryApiKey}`,
    },
    body: JSON.stringify({
      PublishForOrganizationIdentifier: registryConfig.registryOrgCtid,
      Publish: true, // avoid error in node-fetch-cache
      GraphInput: graphDocument,
    }),
  });

  if (!publishResponse.ok) {
    core.error(
      `Response Not OK. Error publishing ${entityType} graph ${graphId}: ${publishResponse.statusText}`
    );
    core.info(JSON.stringify(graphDocument, null, 2));
    return false;
  }

  const publishJson = await publishResponse.json();

  if (publishJson["Successful"] == false) {
    core.error(
      `Errors publishing ${entityType}: ${publishJson["Messages"].join(", ")}`
    );
    return false;
  }

  core.info(`Published ${entityType} ${graphId} with CTID ${ctid}.`);
  return true;
};

/* ---------------
- RUN THE ACTION -
--------------- */
export const run = async () => {
  core.info("Launching Credential Registry Publish Action");

  // Get inputs and validate them
  const urls = core.getInput("urls");
  const registryEnv = core.getInput("registry_env") as RegistryEnvironment;
  const registryBaseUrl = RegistryBaseUrls[registryEnv];
  if (!registryBaseUrl) {
    core.error(
      'Invalid registry environment. Must be one of "sandbox", "staging", or "production".'
    );
    return;
  }
  core.info(`Selected ${registryEnv} environment.`);

  const registryApiKey = core.getInput("registry_api_key");
  if (!registryApiKey) {
    core.error(
      "Invalid registry_api_key input. You must provide a registry API key."
    );
    return;
  }

  const registryOrgCtid = core.getInput("organization_ctid");
  if (!registryOrgCtid) {
    core.error(
      "Invalid organization_ctid input. You must provide a CTID of the Registry organization to publish to."
    );
    return;
  }

  const dryRun = core.getInput("dry_run") === "true";
  if (dryRun) {
    core.info("Dry run: will not publish to the Registry.");
  }

  const registryConfig: RegistryConfig = {
    registryEnv,
    registryBaseUrl,
    registryApiKey,
    registryOrgCtid,
    dryRun,
  };

  // URLs are comma-separated, so split them into an array
  const urlsArray = urls.split(",");
  if (urlsArray.length === 0) {
    core.info("No URLs provided. Exiting.");
    return;
  }
  core.info(
    `Starting with ${urlsArray.length} URL${urlsArray.length > 1 ? "s" : ""}:`
  );
  urlsArray.forEach((url) => {
    core.info(url);
  });

  // Fetch each URL and process the response as JSON. If any URL does not return
  // JSON report an error
  const documents: { [key: string]: any } = {};

  for (const url of urlsArray) {
    const response = await httpClient.fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!response.ok) {
      core.error(`URL ${url} returned status ${response.status}.`);
    } else {
      const json = await response.json();
      if (json) {
        documents[url] = json;
      } else {
        core.error(
          `URL ${url} did not return JSON-formatted data. It will be skipped.`
        );
      }
    }
  }

  const { metadata, urlsForNode } = indexDocuments(documents);
  core.info(JSON.stringify(metadata, null, 2));

  // For documents of supported types found in a graph, publish the document.
  for (const url of urlsArray) {
    const documentMetadata = metadata[url];
    const thisDocument = documents[url];
    if (!documentMetadata.isGraph) {
      await processEntity(thisDocument, registryConfig);
    } else {
      // For each entity in the graph, register it in the entity store
      for (const entity of thisDocument["@graph"]) {
        await processEntity(entity, registryConfig, url);
      }
    }
  }

  // Process entities one layer deep
  const entitiesToProcess = Object.keys(entityStore.entities).filter(
    (entityId) => !entityStore.entities[entityId].processed
  );
  for (const entityId of entitiesToProcess) {
    const entity = entityStore.get(entityId);
    await processEntity(entity.entity, registryConfig, entity.sourceUrl);
  }

  // marshall entities to publish and order their ids into orderedEntitiesToPublish, sorting them by type with
  // Organization and subclasses first, then Credential and subclasses, then everything else
  const orderedEntitiesToPublish = getOrderedEntitiesToPublish(urlsArray);

  core.info("------------ ENTITIES TO PUBLISH ------------");
  orderedEntitiesToPublish.forEach((e) => {
    core.info(
      `${e} <= ${Object.values(entityStore.sameAsIndex).find((v) => v === e)}`
    );
  });

  // Extract a graph for each document, determine if it has a CTID, and publish
  // to the appropriate endpoint for the class
  core.info("------------ BEGINNING PUBLICATION ------------");
  for (const entityId of orderedEntitiesToPublish) {
    const currentEntity = entityStore.get(entityId);
    if (typeof currentEntity?.entity["ceterms:ctid"] !== "string") {
      core.error(
        `Organization ${entityId} does not have a usable CTID. It will not be published.`
      );
    } else {
      const graphDocument = await extractGraphForEntity(
        entityId,
        registryConfig
      );
      if (!graphDocument) {
        core.info(`No graph document found for ${entityId}. Skipping.`);
        continue;
      }

      const publishResult = await publishDocument(
        graphDocument,
        registryConfig,
        getClassMetadata(currentEntity.entity["@type"])
      );

      if (publishResult !== true) {
        core.info(`Failed publication detected. Exiting...`);
        break;
      }
    }
  }
  core.info("------------ PUBLICATION COMPLETE ------------");
};
