import * as core from "@actions/core";
import { httpClient } from "./http";
import { arrayOf, decorateInfoHeader } from "./utils";
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
  getOrderedEntitiesToPublish,
  documentIsCtdlJsonEntity,
  documentIsAGraph,
} from "./graphs";
import { topLevelClassURIs, getClassMetadata, ClassMetadata } from "./ctdl";
import { ActionError, err, handleError } from "./error";

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
    return true;
  }

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
    throw err("Publication failure. See logs for details.", true);
  }

  const publishJson = await publishResponse.json();

  if (publishJson["Successful"] == false) {
    throw err(
      `Errors publishing ${entityType}: ${publishJson["Messages"].join(", ")}`,
      true
    );
  }

  core.info(`Success: Published ${entityType} ${graphId}`);
  return true;
};

/* ---------------
- RUN THE ACTION -
--------------- */
const runInternal = async () => {
  core.info(decorateInfoHeader("Launching Credential Registry Publish Action"));

  // Get inputs and validate them
  const urls = core.getInput("urls");
  const registryEnv = core.getInput("registry_env") as RegistryEnvironment;
  const registryBaseUrl = RegistryBaseUrls[registryEnv];
  if (!registryBaseUrl) {
    throw err(
      'Invalid registry environment. Must be one of "sandbox", "staging", or "production".',
      true
    );
  }
  core.info(`Selected ${registryEnv} environment.`);

  const registryApiKey = core.getInput("registry_api_key");
  if (!registryApiKey) {
    throw err(
      "Invalid registry_api_key input. You must provide a registry API key.",
      true
    );
  }

  const registryOrgCtid = core.getInput("organization_ctid");
  if (!registryOrgCtid) {
    throw err(
      "Invalid organization_ctid input. You must provide a CTID of the Registry organization to publish to.",
      true
    );
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
      throw err(`URL ${url} returned status ${response.status}.`, true);
    } else {
      const json = await response.json();
      if (!json)
        core.error(
          `URL ${url} did not return readable JSON data. It will be skipped.`
        );
      else if (
        documentIsCtdlJsonEntity(json, url) &&
        documentIsAGraph(json, url)
      ) {
        // Process each entity in the graph if we have a graph. The convention is that if a graph appears in a source
        // URL document, it is done to reduce the amount of URL fetching to be done by the action, and thus is trusted.
        // as if it was fetched from its primary URL.
        if (json["@graph"].length) {
          for (const entity of json["@graph"]) {
            entityStore.registerEntity(
              entity,
              true,
              registryConfig,
              url,
              false
            ); // register the entity in unprocessed state
          }
          await processEntity(json["@graph"][0], registryConfig, url);
        }
      } else if (documentIsCtdlJsonEntity(json, url)) {
        // Process just the root single entity if we have a single entity.
        await processEntity(json, registryConfig, url);
      } else {
        core.error(
          `URL ${url} did not return CTDL JSON-LD data. It will be skipped.`
        );
      }
    }
  }

  // Find entities that haven't been fully processed and process them.
  // We don't recurse, we only need to go one layer deep, because we just
  // need to ensure the links are correct within docs that will appear in a graph
  // from one of our primary URLs.
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

  core.info(decorateInfoHeader("ENTITIES TO PUBLISH"));
  orderedEntitiesToPublish.forEach((e) => {
    core.info(
      `${e} <= ${Object.values(entityStore.sameAsIndex).find((v) => v === e)}`
    );
  });

  const topLevelEntitiesNotPublished = Object.values(entityStore.entities)
    .filter(
      (e) =>
        !orderedEntitiesToPublish.includes(e.entity["@id"]) &&
        topLevelClassURIs.includes(e.entity["@type"])
    )
    .map(
      (e) =>
        `${e.entity["@id"]} <= ${
          e.entity["ceterms:sameAs"]
            ? arrayOf(e.entity["ceterms:sameAs"])[0]
            : ""
        } (${e.entity["@type"]})`
    );
  if (topLevelEntitiesNotPublished.length) {
    core.info(
      decorateInfoHeader("REFERENCED ENTITIES NOT TO BE PUBLISHED THIS RUN")
    );
    core.info(
      "Ensure these source URLs are included in a different workflow of the publish action to publish the latest version of these entities."
    );
    topLevelEntitiesNotPublished.forEach((e) => {
      core.info(e);
    });
  }
  // Extract a graph for each document, determine if it has a CTID, and publish
  // to the appropriate endpoint for the class
  core.info(decorateInfoHeader("BEGINNING PUBLICATION"));
  for (const entityId of orderedEntitiesToPublish) {
    const currentEntity = entityStore.get(entityId);
    if (typeof currentEntity?.entity["ceterms:ctid"] !== "string") {
      core.error(
        `Processed entity from ${currentEntity.entity["ceterms:sameAs"]} does not have a usable CTID. It will not be published.`
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
        core.setFailed(
          "One or more resources failed to publish. See logs for details."
        );
        break;
      }
    }
  }
  core.info(decorateInfoHeader("PUBLICATION COMPLETE"));
};

export const run = async () => {
  try {
    await runInternal();
  } catch (error) {
    if (error instanceof ActionError) handleError(error);
    else {
      core.error(error);
      core.setFailed(error.message);
    }
  }
};
