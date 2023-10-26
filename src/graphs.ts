import * as core from "@actions/core";
import { httpClient } from "./http";
import { v4 as uuidv4 } from "uuid";
import {
  BasicEntity,
  DocumentMetadata,
  GraphDocument,
  RegistryConfig,
} from "./types";
import {
  classIsDescendantOf,
  getConditionProfilePointerPropertiesForClass,
  getPropertiesForClass,
  getRangeForProperty,
  getTopLevelPointerPropertiesForClass,
  topLevelClassURIs,
} from "./ctdl";
import {
  arrayOf,
  decorateIndex,
  extractCtidFromUrl,
  replaceIdWithRegistryId,
} from "./utils";

interface StoreEntity {
  fetched: boolean;
  entity: any & {
    "@id": string;
    "@type": string;
  };
  processed: boolean;
  sourceUrl?: string;
}
interface EntityStore {
  [key: string]: StoreEntity;
}

interface Store {
  entities: EntityStore;
  get(idx: string): undefined | StoreEntity;

  /**
   * Returns the StoreEntity with the specified ctid, or undefined if not found.
   * Duplicate ctids on resources of different @id will confuse the system.
   *
   * @param {string} ctid - The ctid of the entity to retrieve.
   * @returns {StoreEntity | undefined} The first StoreEntity with the specified ctid, or undefined if not found.
   */
  getByCtid(ctid: string): undefined | StoreEntity;

  /**
   * Returns the StoreEntity with the specified index, or undefined if not found.
   * This method performs a fuzzy search for the specified index, allowing for matches by either @id or ceterms:sameAs.
   * Search order: (1) @id (which is for references of resource urls and blank notes to be pushed to the registry env),
   * (2) ceterms:sameAs index, (3) by CTID (first found), or (4) undefined if not found.
   *
   * @param {string} idx - The index of the entity to retrieve.
   * @param {string} [ctid] - The ctid of the entity to retrieve, if known.
   * @returns {StoreEntity | undefined} The StoreEntity with the specified index, or undefined if not found.
   */
  getFuzzy(idx: string, ctid?: string): undefined | StoreEntity;

  // Index of ceterms:sameAs references in the graph. Key is the original URL, value is the registry URL.
  // This allows only one value for each URL. Maybe in the future, it would be necessary to track multiple.
  sameAsIndex: { [key: string]: string };

  // Index of entity references in other graphs. Key is the entity, value is an array of strings of other entities
  // that are referenced by the entity. (You can find a link to each of these values in the [key] entity somewhere)
  entitiesReferencedBy: { [key: string]: string[] };
  addReference(from: string, to: string): void;
  entitiesThatReference(id: string): string[];
  registerEntity(
    entity: any,
    fetched: boolean,
    rc: RegistryConfig,
    from?: string,
    processed?: boolean
  ): void;
  reset(): void;
}

export const entityStore: Store = {
  entities: {},
  sameAsIndex: {},
  entitiesReferencedBy: {},
  get: function (id: string) {
    return this.entities[id];
  },
  getByCtid: function (ctid: string) {
    return Object.values(this.entities).find(
      (val: any) => val.entity["ceterms:ctid"] === ctid
    ) as undefined | StoreEntity;
  },
  getFuzzy: function (idx: string, ctid?: string) {
    const idMatch = this.get(idx);
    if (idMatch) return idMatch;

    const sameAsMatch = Object.values(this.entities).find((val: any) =>
      val.entity["ceterms:sameAs"]?.includes(idx)
    );
    if (sameAsMatch) return sameAsMatch;

    return ctid ? this.getByCtid(ctid) : undefined;
  },
  registerEntity(
    entity: any,
    fetched: boolean,
    rc: RegistryConfig,
    from: string | undefined = undefined,
    processed = false
  ) {
    const newEnt = replaceIdWithRegistryId(entity, rc);
    const id = newEnt["@id"];
    if (!id) return;
    const exists = !!this.entities[id];
    if (
      !exists ||
      (exists && fetched && !this.entities[id].fetched) ||
      (exists && processed && !this.entities[id].processed)
    ) {
      this.entities[id] = {
        fetched,
        entity: newEnt,
        processed,
        ...(from ? { sourceUrl: from } : {}),
      };
    }
    if (from) this.addReference(from, id);
    for (const propValue of arrayOf(newEnt["ceterms:sameAs"] ?? [])) {
      this.sameAsIndex[propValue] = id;
    }
    return newEnt;
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

/**
 * Makes an HTTP request to a likely URL to fetch an entity. Register it as unprocessed in the entityStore
 * @param {string} entityUrl - The URL to fetch
 * @param {RegistryConfig} rc - Registry Configuration for the current action run
 * @param {string | undefined} from - Entity ID, a CTID-based URL, the registry destination URL on the current env
 * @returns {StoreEntity | void}
 */
const fetchAndRegisterEntity = async (
  entityUrl: string,
  rc: RegistryConfig,
  from?: string
): Promise<StoreEntity | void> => {
  const entityResponse = await httpClient.fetch(entityUrl);
  if (entityResponse.ok) {
    const jsonData = await entityResponse.json();
    if (
      jsonData["@context"] != "https://credreg.net/ctdl/schema/context/json"
    ) {
      // if the fetched entity does not have the right context, express an error and return
      // In the future, we can JSON-LD compact it into the expected context before continuing
      // But we'll have to check to make sure the language maps and handle [value] => value transforms.
      core.error(
        `Error fetching ${entityUrl}: the fetched entity does not have the expected CTDL context.`
      );
      return;
    }
    // if the fetched entity does not have a CTID, Register it as a blank node.
    if (!jsonData["ceterms:ctid"]) {
      core.info(
        `Found entity with no CTID in ${entityUrl}. Registering as a blank node in the graph.`
      );
      const newBlankNodeIdentifier = `_:b${uuidv4()}`;
      entityStore.registerEntity(
        {
          ...jsonData,
          "@id": newBlankNodeIdentifier,
          "ceterms:sameAs": arrayOf(jsonData["ceterms:sameAs"] ?? []).concat([
            entityUrl,
          ]),
        },
        false,
        rc
      );
      return;
    }
    // if the fetched entity does not have an @id or it is not the same as propValue, express an error and return
    if (jsonData["@id"] != entityUrl) {
      core.error(
        `Error fetching ${entityUrl}: the fetched entity does not have an @id or it is not the same as the requested URL.`
      );
      return;
    }

    const newEntity = entityStore.registerEntity(jsonData, true, rc, from);
    return newEntity;
  }
};

const processConditionProfile = async (
  cp: { "@type": string; [key: string]: any },
  rc: RegistryConfig,
  parentEntityId?: string
) => {
  let ret = {
    ...cp,
  };
  const pointers = getTopLevelPointerPropertiesForClass(
    "ceterms:ConditionProfile"
  );
  for (const prop of pointers) {
    let tempArray: string[] = [];
    if (cp[prop]) {
      for (const propValue of arrayOf(cp[prop])) {
        // Filter out erroneous non-string values
        if (typeof propValue !== "string") continue;

        const matchingEntity = entityStore.getFuzzy(propValue);
        if (matchingEntity) {
          // if a string reference is already registered, just replace it with the registryId based on the CTID
          tempArray.push(matchingEntity.entity["@id"]);
        } else if (propValue.startsWith("http")) {
          // If propValue looks like a Registry URL from any environment, treat it like a resource that will
          // exist in the current environment either now or later.
          const ctid_match = extractCtidFromUrl(propValue);
          if (ctid_match) {
            core.info(
              `ConditionProfile references resource ${propValue} which has CTID ${ctid_match}. Recording as a reference to the current registry environment.`
            );
            tempArray.push(`${rc.registryBaseUrl}/resources/${ctid_match}`);
          }

          // Handle Problematic URLs, just register them under this URL
          // This just completely fails to go get the entity and extract its CTID.
          // Instead, we need to get the entity in our store registered by CTID and then use a reference by CTID-based identifier on The current registry environment
          core.info(
            `Found reference in ConditionProfile to URL to fetch and register: ${propValue}`
          );
          const newEntity = await fetchAndRegisterEntity(
            propValue,
            rc,
            parentEntityId
          );
          if (newEntity) tempArray.push(newEntity["@id"]);
        }
      }
      ret[prop] = tempArray;
    }
  }
  return ret;
};

export const processEntity = async (
  entity: BasicEntity & any,
  rc: RegistryConfig,
  sourceGraphUrl: string | undefined = undefined
) => {
  const entityType = arrayOf(entity["@type"]) as string[];
  const entityId = entity["@id"];

  // Make no changes to the entity if it is not a top-level class... consider should it be registered though?
  if (entityType.length === 0 || !topLevelClassURIs.includes(entityType[0]))
    return entity;

  if (!entity["ceterms:ctid"] && !entityId.startsWith("_:")) {
    core.error(`No CTID found in entity ${entityId}`);
    return;
  }

  let doc = {
    ...entity,
  };

  // Process @id sameAs reference
  if (
    doc["@id"] &&
    !doc["@id"].startsWith(`${rc.registryBaseUrl}/resources/`) &&
    !doc["@id"].startsWith("_:")
  ) {
    doc["ceterms:sameAs"] = arrayOf(doc["ceterms:sameAs"] ?? [])
      .filter((e) => e != doc["@id"])
      .concat([doc["@id"]]);
    doc["@id"] = `${rc.registryBaseUrl}/resources/${doc["ceterms:ctid"]}`;
  }

  const entityPrimaryType = entityType[0];
  const pointers = new Set(
    getTopLevelPointerPropertiesForClass(entityPrimaryType).concat(
      getConditionProfilePointerPropertiesForClass(entityPrimaryType)
    )
  );

  for (const prop of pointers) {
    if (doc[prop]) {
      // TODO: Separate out into function with signature doc[prop] = processProperty(doc, prop, ...)
      const propArray = arrayOf(doc[prop]);
      let tempArray: any[] = [];
      for (const [index, propValue] of propArray.entries()) {
        if (typeof propValue === "string") {
          // if a string reference is already registered, just replace it with the registryId based on the CTID
          if (entityStore.getFuzzy(propValue)) {
            const existingEntity = entityStore.getFuzzy(propValue);
            tempArray.push(existingEntity.entity["@id"]);
            continue;
          }

          // If propValue looks like a Registry URL from any environment, treat it like a resource that will
          // exist in the current environment either now or later.
          const ctid_match = extractCtidFromUrl(propValue);
          if (ctid_match) {
            core.info(
              `ConditionProfile references resource ${propValue} which has CTID ${ctid_match}. Recording as a reference to the current registry environment.`
            );
            tempArray.push(`${rc.registryBaseUrl}/resources/${ctid_match}`);
          }

          // if propValue otherwise looks like an HTTP url fetch it and index its CTID
          else if (propValue.startsWith("http")) {
            core.info(
              `Fetching document with reference ${doc["@id"]} -> ${prop} [${index}]: ${propValue}`
            );
            const newEntity = await fetchAndRegisterEntity(
              propValue,
              rc,
              doc["@id"]
            );
            tempArray.push(newEntity["@id"]);
          }
        }
        // else if propValue is an object, it may need to be embedded or may need to be separated
        // (either as a reference to another registry resource or presented as a blank node in this
        // graph), depending on its type and whether or not is has a CTID defined.
        else if (typeof propValue === "object") {
          // if it has a type defined, check if it is in range of the expected node types for this
          // property. Throw an error if not.
          const nodeType = propValue["@type"];
          const inRangeTypesForProp = nodeType ? getRangeForProperty(prop) : [];

          // Leave in place if there is no type. API validation will catch it if it's a problem.
          if (!nodeType || typeof nodeType !== "string") {
            tempArray.push(propValue);
            continue;
          }

          // Case A: If it is a declared but unsupported value for this property, throw an error.
          if (!inRangeTypesForProp.includes(nodeType)) {
            core.error(
              `Error: invalid value of type ${nodeType} for property ${prop} ${decorateIndex(
                index
              )} in entity ${entityId}`
            );
            return;
          }

          // Case B: It is a ConditionProfile, which is a special case that is always embedded
          if (
            arrayOf(propValue["@type"]).includes("ceterms:ConditionProfile")
          ) {
            tempArray.push(
              await processConditionProfile(propValue, rc, doc["@id"])
            );
          }

          // Case B: It is declared here as a blank node. Push it out separately in the graph
          else if (
            topLevelClassURIs.includes(nodeType) &&
            typeof propValue["@id"] === "string" &&
            propValue["@id"].startsWith("_:")
          ) {
            const newEntity = entityStore.registerEntity(
              propValue,
              false,
              rc,
              doc["@id"]
            );
            tempArray.push(newEntity["@id"]);
          }

          // Case C: It is a reference to another node with its own URL that may be published,
          // as the top-level entity of its own graph. It'll be referenced by its CTID here.
          else if (
            topLevelClassURIs.includes(nodeType) &&
            typeof propValue["ceterms:ctid"] === "string"
          ) {
            const newEntity = entityStore.registerEntity(
              propValue,
              false,
              rc,
              doc["@id"]
            );

            tempArray.push(newEntity["@id"]);
          }

          // Case D: It is a reference to another entity by URL, but it doesn't have a CTID, so we'll include it as a
          // blank node.
          else if (topLevelClassURIs.includes(nodeType)) {
            const newBlankNodeIdentifier = `_:b${uuidv4()}`;
            const newEntity = entityStore.registerEntity(
              {
                ...propValue,
                "@id": newBlankNodeIdentifier,
                ...(propValue["@id"]
                  ? {
                      "ceterms:sameAs": arrayOf(
                        propValue["ceterms:sameAs"] ?? []
                      ).concat([propValue["@id"]]),
                    }
                  : {}),
              },
              false,
              rc,
              doc["@id"]
            );
            tempArray.push(newEntity["@id"]);
          }

          // Case E: Otherwise, leave the element in place; it meets requirements or will be rejected by API
          else {
            tempArray.push(propValue);
          }
        }
      }
      doc[prop] = tempArray;
    }
  }

  // Register this as fetched and processed. TODO, writing over fetched here, double check for problems.
  entityStore.registerEntity(doc, true, rc, sourceGraphUrl, true);
  return doc;
};

/**
 * Ensures that links and IDs are correct within each document that might show up in the graph for an entity that will be published.
 * @param {string} from - The id of the entity whose directly-linked entities you want to ensure are ready for publishing.
 * @returns {void}
 */
const ensureReferencedEntitiesAreProcessed = async (
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
      await ensureReferencedEntitiesAreProcessed(entityId, rc);
    }
  }
};

export const extractGraphForEntity = (
  entityId: string,
  rc: RegistryConfig
): GraphDocument | void => {
  const entity = entityStore.get(entityId);
  if (!entity) return;

  const referencedIds = entityStore.entitiesReferencedBy[entityId];

  // Include only the entities that can be found that:
  // - are not top-level classes (which will be published separately)
  // unless they are blank nodes.
  const referencedEntities =
    referencedIds
      ?.map((id) => entityStore.get(id)?.entity)
      .filter(
        (e) =>
          !!e &&
          e["@id"] &&
          (e["@id"].startsWith("_:") ||
            !topLevelClassURIs.includes(
              arrayOf(e["@type"] ?? ["ceterms:Organization"])[0]
            ))
      ) ?? [];

  return {
    "@context": "https://credreg.net/ctdl/schema/context/json",
    // "@id": `${rc.registryBaseUrl}/graph/${entity.entity["ceterms:ctid"]}`,
    "@graph": [entity.entity, ...referencedEntities],
  };
};

export const getOrderedEntitiesToPublish = (urlsArray) => {
  const entityIds = Object.values(entityStore.entities)
    .filter((entity) => {
      // Entity @id is in urlsArray or a sameAs value referencing this entity is in urlsArray
      const entityId = entity.entity["@id"];
      const sameAs = arrayOf(entity.entity["ceterms:sameAs"] ?? []);
      return (
        urlsArray.includes(entityId) ||
        sameAs.some((url) => urlsArray.includes(url))
      );
    })
    .filter((entity) => {
      // Entity is a top-level class
      const entityType = arrayOf(entity.entity["@type"] ?? [""]);
      return topLevelClassURIs.includes(entityType[0]);
    })
    .sort((a, b) => {
      const aType: string = arrayOf(a.entity["@type"] ?? [""])[0];
      const bType: string = arrayOf(b.entity["@type"] ?? [""])[0];

      const aIsOrg = classIsDescendantOf(aType, "ceterms:Organization");
      const bIsOrg = classIsDescendantOf(bType, "ceterms:Organization");

      if (aIsOrg && !bIsOrg) return -1;
      else if (!aIsOrg && bIsOrg) return 1;

      const aIsCred = classIsDescendantOf(aType, "ceterms:Credential");
      const bIsCred = classIsDescendantOf(bType, "ceterms:Credential");

      if (aIsCred && !bIsCred) return -1;
      else if (!aIsCred && bIsCred) return 1;
      else return 0;
    })
    .map((entity) => entity.entity["@id"]);
  return entityIds;
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

  // For each document, validate that it is a graph, and index the value of the @type property for
  // each entity as DocumentMetadata
  Object.keys(documents).forEach((url) => {
    const responseData = documents[url];
    let graph: any[] = [];
    let ctidsById: { [key: string]: string } = {};
    let isGraph = false;
    if (validateGraph(url, responseData)) {
      isGraph = true;
      graph = arrayOf(responseData["@graph"]);
    } else if (typeof responseData === "object" && responseData !== null) {
      graph = [responseData];
    }

    let entitiesByType: { [key: string]: string[] } = {};
    // This makes the assumption that if the same node appears in multiple graphs, any one of the
    // graphs will contain all of the types for that node.
    let entityTypes: { [key: string]: string[] } = {};

    graph.forEach((entity) => {
      // If the URL of this document does not yet appear in the array of URLs that contain this
      // node, index it there
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
