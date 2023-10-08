import * as core from "@actions/core";
import fetch from "node-fetch-cache";
import { v4 as uuidv4 } from "uuid";
import {
  BasicEntity,
  DocumentMetadata,
  GraphDocument,
  RegistryConfig,
} from "./types";
import {
  getTopLevelPointerPropertiesForClass,
  topLevelClassURIs,
} from "./ctdl";
import { arrayOf, replaceIdWithRegistryId } from "./utils";

interface EntityStore {
  [key: string]: {
    fetched: boolean;
    entity: any & {
      "@id": string;
      "@type": string;
    };
    processed: boolean;
  };
}

interface Store {
  entities: EntityStore;
  get(id: string): any;

  // Index of ceterms:sameAs references in the graph. Key is the original URL, value is the registry URL.
  // This allows only one value for each URL. Maybe in the future, it would be necessary to track multiple.
  sameAsIndex: { [key: string]: string };

  // Index of entity references in other graphs. Key is the entity, value is an array of strings of other entities
  // referenced by the entity.
  entitiesReferencedBy: { [key: string]: string[] };
  addReference(from: string, to: string): void;
  entitiesThatReference(id: string): string[];
  registerEntity(
    entity: any,
    fetched: boolean,
    from?: string,
    processed?: boolean
  ): void;
  reset(): void;
}

export const entityStore: Store = {
  entities: {},
  sameAsIndex: {},
  entitiesReferencedBy: {},
  get(id: string) {
    return this.entities[id];
  },
  registerEntity(
    entity: any,
    fetched: boolean,
    from: string | undefined = undefined,
    processed = false
  ) {
    const id = entity["@id"];
    if (!id) return;
    const exists = !!this.entities[id];
    if (!exists || (exists && fetched && !this.entities[id].fetched)) {
      this.entities[id] = {
        fetched,
        entity,
        processed,
      };
    }
    if (from) this.addReference(from, id);
  },
  // Track a reference so we can pull relevant entities out of the graph later
  addReference(from: string, to: string) {
    if (
      !this.entitiesReferencedBy[from] ||
      this.entitiesReferencedBy[from]?.indexOf(to) === -1
    )
      this.entitiesReferencedBy[from] = [
        ...(this.entitiesReferencedBy[from] ?? []),
        to,
      ];
  },
  entitiesThatReference(id: string) {
    return Object.keys(this.entitiesReferencedBy).filter((key) =>
      this.entitiesReferencedBy[key].includes(id)
    );
  },
  reset() {
    this.entities = {};
    this.sameAsIndex = {};
    this.entitiesReferencedBy = {};
  },
};

export const processEntity = async (
  entity: BasicEntity & any,
  rc: RegistryConfig,
  sourceGraphUrl: string | undefined = undefined
) => {
  const entityType = arrayOf(entity["@type"]) as string[];
  const entityId = entity["@id"];

  if (entityType.length === 0 || !topLevelClassURIs.includes(entityType[0]))
    return entity;

  let doc = {
    ...entity,
  };

  // Process @id sameAs reference
  if (!doc["@id"].startsWith(`${rc.registryBaseUrl}/resources/`)) {
    doc["ceterms:sameAs"] = arrayOf(doc["ceterms:sameAs"] ?? [])
      .filter((e) => e != doc["@id"])
      .concat([doc["@id"]]);
    doc["@id"] = `${rc.registryBaseUrl}/resources/${doc["ceterms:ctid"]}`;
  }

  const entityPrimaryType = entityType[0];
  const pointers = getTopLevelPointerPropertiesForClass(entityPrimaryType);

  for (const prop of pointers) {
    if (doc[prop]) {
      const propArray = arrayOf(doc[prop]);
      let tempArray = [];
      for (const [index, propValue] of propArray.entries()) {
        if (typeof propValue === "string") {
          // if a string reference is already registered, just replace it with the registryId based on the CTID
          if (entityStore.get(propValue)) {
            const propValueCtid = entityStore.get(propValue)["ceterms:ctid"];
            tempArray.push(`${rc.registryBaseUrl}/resources/${propValueCtid}`);
          } else if (propValue.startsWith(`${rc.registryBaseUrl}/resources/`)) {
            core.info(
              `LearningProgram ${doc["ceterms:ctid"]} references resource ${propValue} which is already in the registry. Not adding it to graph.`
            );
            tempArray.push(propValue);
          }
          // If propValue is a URL that was already fetched that is sameAs another URL in the graph,
          // replace it with the registry URL that is now the canonical reference to this graph entry
          else if (entityStore.sameAsIndex[propValue]) {
            core.info(
              `LearningProgram ${doc["ceterms:ctid"]} references resource ${propValue} which is already in the registry. ` +
                `Replacing with ${entityStore.sameAsIndex[propValue]}.`
            );
            tempArray.push(entityStore.sameAsIndex[propValue]);
          }
          // if propValue looks like an HTTP url fetch it
          else if (propValue.startsWith("http")) {
            core.info(
              `Fetching document with reference ${doc["@id"]} -> ${prop} [${index}]: ${propValue}`
            );
            const propValueResponse = await fetch(propValue);
            if (propValueResponse.ok) {
              const propValueJson = await propValueResponse.json();
              // if the fetched entity does not have the right context, express an error and return
              if (
                propValueJson["@context"] !=
                "https://credreg.net/ctdl/schema/context/json"
              ) {
                core.error(
                  `Error fetching ${propValue}: the fetched entity does not have the expected CTDL context.`
                );
                return;
              }
              // if the fetched entity does not have a CTID, express an error and return
              if (!propValueJson["ceterms:ctid"]) {
                core.error(
                  `Error fetching ${propValue}: the fetched entity does not have a self-assigned CTID.`
                );
                return;
              }
              // if the fetched entity does not have an @id or it is not the same as propValue, express an error and return
              if (propValueJson["@id"] != propValue) {
                core.error(
                  `Error fetching ${propValue}: the fetched entity does not have an @id or it is not the same as the requested URL.`
                );
                return;
              }
              const idReplacedJson = replaceIdWithRegistryId(propValueJson, rc);
              entityStore.registerEntity(idReplacedJson, true, entityId);
              entityStore.sameAsIndex[propValueJson["@id"]] =
                idReplacedJson["@id"];
              tempArray.push(
                `${rc.registryBaseUrl}/resources/${propValueJson["ceterms:ctid"]}`
              );
            }
          }
        }
        // else if propValue is an object, it is a blank node
        // add it to the graphData and replace reference to it with a newly assigned blank node identifier
        // or it's id
        else if (typeof propValue === "object") {
          if (
            typeof propValue["@id"] === "string" &&
            propValue["@id"].startsWith("_:")
          ) {
            entityStore.registerEntity(propValue, false, entityId);
            tempArray.push(propValue["@id"]);
          } else if (typeof propValue["@id"] === "string") {
            const newBlankNodeIdentifier = `_:b${uuidv4()}`;
            entityStore.registerEntity(
              {
                ...propValue,
                "@id": newBlankNodeIdentifier,
                "ceterms:sameAs": [
                  ...arrayOf(propValue["ceterms:sameAs"] ?? []),
                  propValue["@id"],
                ],
              },
              false,
              entityId
            );

            tempArray.push(newBlankNodeIdentifier);
            entityStore.sameAsIndex[propValue["@id"]] = newBlankNodeIdentifier;
          } else {
            const newBlankNodeIdentifier = `_:b${uuidv4()}`;
            tempArray.push(newBlankNodeIdentifier);
            entityStore.registerEntity(
              {
                ...propValue,
                "@id": newBlankNodeIdentifier,
              },
              false,
              entityId
            );
          }
        }
      }
      doc[prop] = tempArray;
    }
  }

  // Register this as fetched and processed. TODO, writing over fetched here, double check for problems.
  entityStore.registerEntity(doc, true, sourceGraphUrl, true);
  return doc;
};

const recurseUntilAllProcessedEntities = async (
  from: string,
  rc: RegistryConfig
) => {
  const entities = entityStore.entitiesReferencedBy[from];
  if (!entities) return;
  for (const entityId of entities) {
    if (entityStore.get(entityId).processed === false) {
      const processedEntity = await processEntity(
        entityStore.get(entityId).entity,
        rc
      );
      entityStore.get(entityId).processed = true;
      entityStore.get(entityId).entity = processedEntity;
      await recurseUntilAllProcessedEntities(entityId, rc);
    }
  }
};

// In progress... maybe a good idea
export const extractGraphForEntity = (
  entityId: string,
  rc: RegistryConfig
): GraphDocument | void => {
  const entity = entityStore.get(entityId);
  if (!entity) return;

  const referencedIds = entityStore.entitiesReferencedBy[entityId];
  const referencedEntities =
    referencedIds
      ?.map((id) => entityStore.get(id)?.entity)
      .filter((e) => !!e) ?? [];
  return {
    "@context": "https://credreg.net/ctdl/schema/context/json",
    "@id": `${rc.registryBaseUrl}/graph/${entity.entity["ceterms:ctid"]}`,
    "@graph": [entity.entity, ...referencedEntities],
  };
};

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

  if (!responseData["@graph"]) {
    return false;
  }

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