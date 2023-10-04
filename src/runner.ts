import * as core from "@actions/core";
import fetch from "node-fetch-cache";

import { CredentialSubtypes } from "./credential";
import { arrayOf } from "./utils";
import {
  RegistryEnvironment,
  RegistryBaseUrls,
  RegistryConfig,
  DocumentMetadata,
} from "./types";
import { context } from "@actions/github";
import { publishLearningProgram } from "./learningProgram";

export const validateGraph = (url: string, responseData: object): boolean => {
  // validate context matches CTDL expectation:
  // https://credreg.net/ctdl/schema/context/json
  if (!responseData["@context"]) {
    core.error(`No @context found in document ${url}`);
    return false;
  }

  const contextArray = arrayOf(responseData["@context"]);
  if (
    contextArray.length === 0 ||
    contextArray.length > 1 ||
    contextArray[0] !== "https://credreg.net/ctdl/schema/context/json"
  ) {
    core.error(
      `URL ${url} did not return expected @context. Use https://credreg.net/ctdl/schema/context/json`
    );
    return false;
  }

  //   if (!responseData["@graph"]) {
  //     core.error(
  //       `This tool only supports ingestion of CTDL data in @graph format at this time. No @graph found in document ${url}`
  //     );
  //     return false;
  //   }

  return true;
};

export const indexDocuments = (documents: { [key: string]: any }) => {
  // Index the IDs and types of each entity in the @graph of each document
  let metadata: { [key: string]: DocumentMetadata } = {};

  // Nodes identifies the document URLs in which the node is represented in the graph.
  let urlsForNode: { [key: string]: string[] } = {};

  // For each document, validate that it is a graph, and index the value of the @type property for each entity as DocumentMetadata
  Object.keys(documents).forEach((url) => {
    const responseData = documents[url];
    let graph = [];
    let ctidsById: { [key: string]: string } = {};
    let isGraph = false;
    if (validateGraph(url, responseData)) {
      isGraph = true;
      graph = arrayOf(responseData["@graph"]);
    } else if (typeof responseData === "object" && responseData !== null) {
      graph = [responseData];
    }

    let entitiesByType: { [key: string]: string[] } = {};
    // This makes the assumption that if the same node appears in multiple graphs, any one of the graphs will contain all of the types for that node.
    let entityTypes: { [key: string]: string[] } = {};

    graph.forEach((entity) => {
      // If the URL of this document does not yet appear in the array of URLs that contain this node, index it there
      if (!urlsForNode[entity["@id"]]) {
        urlsForNode[entity["@id"]] = [url];
      } else if (!urlsForNode[entity["@id"]].includes(url)) {
        urlsForNode[entity["@id"]].push(url);
      }

      const type = entity["@type"];
      if (type) {
        const typeArray = arrayOf(type) as string[];
        entityTypes[entity["@id"]] = typeArray;
        if (entity["ceterms:ctid"]) {
          ctidsById[entity["@id"]] = entity["ceterms:ctid"];
        }
        typeArray.forEach((et) => {
          // Register this entity @id in the appropriate entitiesByType
          if (!entitiesByType[et]) {
            entitiesByType[et] = [entity["@id"]];
          } else {
            entitiesByType[et].push(entity["@id"]);
          }
        });
      }
    });

    metadata[url] = {
      url,
      isGraph: isGraph,
      errors: [],
      entityTypes,
      entitiesByType,
      ctidsById,
    };
  });

  return { metadata, urlsForNode };
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

  const registryConfig: RegistryConfig = {
    registryEnv,
    registryBaseUrl,
    registryApiKey,
    registryOrgCtid,
  };

  // URLs are comma-separated, so split them into an array
  const urlsArray = urls.split(",");
  if (urlsArray.length === 0) {
    core.info("No URLs provided. Exiting.");
    return;
  }
  core.info(
    `Starting with ${urlsArray.length} URL${
      urlsArray.length > 1 ? "s" : ""
    }: ${urlsArray.join(" ")}`
  );

  // Fetch each URL and process the response as JSON. If any URL does not return JSON report an error
  const documents: { [key: string]: any } = {};

  await Promise.all(
    urlsArray.map(async (url) => {
      // error if the URL does not start with http or https
      if (!url.match(/^https?:\/\//)) {
        core.error(
          `Invalid URL: ${url} does not start with http or https. Check your comma-separated input for any typos.`
        );
        return;
      }

      const response = await fetch(url, {
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
    })
  );

  const { metadata, urlsForNode } = indexDocuments(documents);
  core.info(JSON.stringify(metadata, null, 2));

  // For documents of supported types found in a graph, publish the document.
  const results = await Promise.all(
    urlsArray.map(async (url) => {
      const documentMetadata = metadata[url];
      const thisDocument = documents[url];
      if (documentMetadata.isGraph) {
        const firstEntityType = thisDocument["@graph"][0]["@type"];
        if (firstEntityType == "ceterms:LearningProgram") {
          if (
            metadata[url].ctidsById[thisDocument["@graph"][0]["@id"]] ===
            undefined
          ) {
            core.error(
              `${thisDocument["@graph"][0]["@id"]}: Could not publish LearningProgram Graph ${url}, because it does not declare a CTID.`
            );
          } else {
            await publishLearningProgram(
              thisDocument,
              metadata[url],
              registryConfig
            );
          }
        }
      } else {
        core.info(
          "TODO: implement spidering for certain classes and packaging as a graph for publication"
        );
      }
    })
  );
};
