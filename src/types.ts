export type RegistryEnvironment = "sandbox" | "staging" | "production";

export const RegistryBaseUrls: { [key in RegistryEnvironment]: string } = {
  sandbox: "https://sandbox.credentialengineregistry.org",
  staging: "https://staging.credentialengineregistry.org",
  production: "https://credentialengineregistry.org",
};

export const AssistantBaseUrls: { [key in RegistryEnvironment]: string } = {
  sandbox: "https://sandbox.credentialengine.org/assistant",
  staging: "https://staging.credentialengine.org/assistant",
  production: "https://credentialengine.org/assistant",
};

export interface RegistryConfig {
  registryEnv: RegistryEnvironment;
  registryBaseUrl: string;
  registryApiKey: string;
  registryOrgCtid: string;
  dryRun: boolean;
}

export interface DocumentMetadata {
  url: string;
  isGraph: boolean;
  errors: string[];
  entityTypes: { [key: string]: string[] };
  entitiesByType: { [key: string]: string[] };
  ctidsById: { [key: string]: string };
}

export interface GraphDocument {
  "@graph": any[];
  "@context": string;
  "@id"?: string;
}

export interface BasicEntity {
  "@id": string;
  "@type": string | string[];
}
