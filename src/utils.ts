import { RegistryConfig } from "./types";

export const arrayOf = <T>(type: T | T[]): T[] => {
  if (Array.isArray(type)) {
    return type;
  }
  return [type];
};

export const replaceIdWithRegistryId = (
  entity: any,
  registryConfig: RegistryConfig
) => {
  const id = entity["@id"];
  const ctidBasedId = `${registryConfig.registryBaseUrl}/resources/${entity["ceterms:ctid"]}`;
  if (!id || !entity["ceterms:ctid"] || id == ctidBasedId) return entity;

  return {
    ...entity,
    "@id": ctidBasedId,
    "ceterms:sameAs": [...arrayOf(entity["ceterms:sameAs"] ?? []), id],
  };
};

export const decorateIndex = (index: number): string =>
  index > 0 ? `[${index}]` : "";
