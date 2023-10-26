import { RegistryBaseUrls, RegistryConfig } from "./types";

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
    ...(entity["ceterms:ctid"] ? { "@id": ctidBasedId } : {}),
    ...(id.startsWith("_:")
      ? {}
      : { "ceterms:sameAs": [...arrayOf(entity["ceterms:sameAs"] ?? []), id] }),
  };
};

export const decorateIndex = (index: number): string =>
  index > 0 ? `[${index}]` : "";

export const extractCtidFromUrl = (url: string): string | undefined => {
  // If on any Registry Environment, this is a resource URL, extract the CTID
  return Object.values(RegistryBaseUrls).find((env) => {
    const matcher = new RegExp(
      `${env}/resources/(ce-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`,
      "i"
    );
    const match = url.match(matcher);
    if (match) {
      return match[1];
    }
  });
};
