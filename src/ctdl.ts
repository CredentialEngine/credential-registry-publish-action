// Documentation and utility classes governing how the Credential Registry API handles various classes.
// Particularly, identifying which classes are primary (have a CTID), and which are secondary (do not).
// Primary classes should be published as a graph with one such entity as the first object, and no other
// instances of primary classes should be included in the graph. Such other instances should be referenced
// by ID as a string and published as their own graph.

import { schema as CtdlSchema } from "./ctdl-schema";
import { schema as CtdlAsnSchema } from "./ctdlasn-schema";
import { schema as QDataSchema } from "./qdata-schema";
export const endpoints = {
  // Organization and subtypes
  "ceterms:CredentialOrganization": "/organization/publishGraph",
  "ceterms:Organization": "/organization/publishGraph",
  "ceterms:QACredentialOrganization": "/organization/publishGraph",

  // Credential and subtypes
  "ceterms:Credential": "/credential/publishGraph",
  "ceterms:ApprenticeshipCertificate": "/credential/publishGraph",
  "ceterms:AssociateDegree": "/credential/publishGraph",
  "ceterms:AssociateOfAppliedArtsDegree": "/credential/publishGraph",
  "ceterms:AssociateOfAppliedScienceDegree": "/credential/publishGraph",
  "ceterms:AssociateOfArtsDegree": "/credential/publishGraph",
  "ceterms:AssociateOfScienceDegree": "/credential/publishGraph",
  "ceterms:BachelorDegree": "/credential/publishGraph",
  "ceterms:BachelorOfArtsDegree": "/credential/publishGraph",
  "ceterms:BachelorOfScienceDegree": "/credential/publishGraph",
  "ceterms:Badge": "/credential/publishGraph",
  "ceterms:Certificate": "/credential/publishGraph",
  "ceterms:CertificateOfCompletion": "/credential/publishGraph",
  "ceterms:Certification": "/credential/publishGraph",
  "ceterms:Degree": "/credential/publishGraph",
  "ceterms:DigitalBadge": "/credential/publishGraph",
  "ceterms:Diploma": "/credential/publishGraph",
  "ceterms:DoctoralDegree": "/credential/publishGraph",
  "ceterms:GeneralEducationDevelopment": "/credential/publishGraph",
  "ceterms:JourneymanCertificate": "/credential/publishGraph",
  "ceterms:License": "/credential/publishGraph",
  "ceterms:MasterCertificate": "/credential/publishGraph",
  "ceterms:MastersDegree": "/credential/publishGraph",
  "ceterms:MasterOfArtsDegree": "/credential/publishGraph",
  "ceterms:MasterOfScienceDegree": "/credential/publishGraph",
  "ceterms:MicroCredential": "/credential/publishGraph",
  "ceterms:OpenBadge": "/credential/publishGraph",
  "ceterms:ProfessionalDoctorate": "/credential/publishGraph",
  "ceterms:QualityAssuranceCredential": "/credential/publishGraph",
  "ceterms:ResearchDoctorate": "/credential/publishGraph",
  "ceterms:SecondarySchoolDiploma": "/credential/publishGraph",
  "ceterms:SpecialistDegree": "/credential/publishGraph",

  // Learning Opportunity (and Course, specifically)
  "ceterms:Course": "/course/publishGraph",
  "ceterms:LearningOpportunityProfile": "/learningopportunity/publishGraph",
  "ceterms:LearningProgram": "/learningprogram/publishGraph",
};

export interface ClassMetadata {
  className: string; // e.g. 'ceterms:CredentialOrganization'
  subClassOf?: string; // e.g. 'ceterms:Organization'
  isPrimary: boolean;
  publishEndpoint?: string; // route subsidiary to registry base URL, e.g. `/course/publishgraph
}

//Add any missing URIs from the source array to the destination array
const appendURIs = (destination, source) => {
  destination &&
    source &&
    source
      .filter((uri) => !destination.includes(uri))
      .forEach((uri) => destination.push(uri));
};

//Append terms to schemaData.merged
const appendTerms = (destination, source) => {
  //For each term in the source...
  source.forEach((term) => {
    //Find a match in schemaData.merged
    var match = destination.find(
      (otherTerm) => otherTerm["@id"] == term["@id"]
    );
    //If found...
    if (match) {
      //Append any missing URIs to the term's domain and range (needed to accommodate any subtle differences in domains/ranges between schemas, which generally shouldn't happen anyway)
      appendURIs(match["schema:domainIncludes"], term["schema:domainIncludes"]);
      appendURIs(match["schema:rangeIncludes"], term["schema:rangeIncludes"]);
    }
    //Otherwise...
    else {
      //Add the term to schemaData.merged (may want to copy it instead so as not to alter the original term when its domain/range are updated?)
      schemaData.merged.push(term);
    }
  });
};

export const getMaybePointerPropertiesForClass = (
  className: string
): string[] => {
  //Account for properties that may or may not reference a top-level class
  const classProps = schemaData.merged.filter(
    (property) =>
      property["@type"] === "rdf:Property" &&
      (property["schema:rangeIncludes"]?.includes("xsd:anyURI") ||
        property["schema:rangeIncludes"]?.includes("rdfs:Resource"))
  );
  return classProps.map((prop) => prop["@id"]);
};

export const getClassMetadata = (className: string): ClassMetadata => {
  const classInfo = schemaData.ctdl.find(
    (entity) => entity["@id"] === className
  );
  const subClassOf = classInfo?.["rdfs:subClassOf"]
    ? classInfo["rdfs:subClassOf"].find((e) => e.startsWith("ceterms:"))
    : undefined;
  const isPrimary = topLevelClassURIs.includes(className);
  const publishEndpoint = endpoints[className];
  return {
    className,
    ...(subClassOf && { subClassOf }),
    isPrimary,
    ...(publishEndpoint && { publishEndpoint }),
  };
};

export const getPropertiesForClass = (className: string): string[] => {
  const properties = schemaData.merged.filter(
    (entity) =>
      entity["@type"] === "rdf:Property" &&
      entity["schema:domainIncludes"]?.includes(className)
  );
  const propertyNames = properties.map((prop) => prop["@id"]);
  return propertyNames;
};

export const getRangeForProperty = (propertyName: string): string[] => {
  const property = schemaData.merged.find(
    (entity) => entity["@id"] === propertyName
  );
  return property ? property["schema:rangeIncludes"] ?? [] : [];
};

export const getTopLevelPointerPropertiesForClass = (
  className: string
): string[] => {
  const classProps = schemaData.merged.filter(
    (entity) =>
      entity["@type"] === "rdf:Property" &&
      entity["schema:domainIncludes"]?.includes(className) &&
      entity["schema:rangeIncludes"]?.some((range) =>
        topLevelClassURIs.includes(range)
      )
  );
  return classProps.map((prop) => prop["@id"]);
};

// Get the properties that might have a ceterms:ConditionProfile entity in range:
export const getConditionProfilePointerPropertiesForClass = (
  className: string
): string[] => {
  const classProps = schemaData.merged.filter(
    (entity) =>
      entity["@type"] === "rdf:Property" &&
      entity["schema:domainIncludes"]?.includes(className) &&
      entity["schema:rangeIncludes"]?.some(
        (c) => "ceterms:ConditionProfile" == c
      )
  );
  return classProps.map((prop) => prop["@id"]);
};

export const classIsDescendantOf = (c: string, ancestor: string) => {
  if (c === ancestor) return true;
  const parent = classMetadata[c]?.subClassOf as string | undefined;
  if (!parent) return false;
  if (parent === ancestor) return true;
  return classIsDescendantOf(parent, ancestor);
};

//Hold all schema data
let schemaData = {
  ctdl: CtdlSchema,
  ctdlasn: CtdlAsnSchema,
  qdata: QDataSchema,
  merged: [],
};

// Process Schemas
appendTerms(schemaData.merged, schemaData.ctdl);
appendTerms(schemaData.merged, schemaData.ctdlasn);
appendTerms(schemaData.merged, schemaData.qdata);

//For each top-level class (ie class with a CTID), render the class and the properties for that class which point to a top-level class
//Get the CTID property and top-level classes
const ctidProperty =
  schemaData.merged.find((item) => item["@id"] == "ceterms:ctid") ?? {};

export const topLevelClasses = schemaData.merged.filter((item) =>
  ctidProperty["schema:domainIncludes"].includes(item["@id"])
);
export const topLevelClassURIs = topLevelClasses.map((item) => item["@id"]);

export const classMetadata = schemaData.merged.reduce((acc, item, ind, arr) => {
  const thisMeta =
    item["@type"] === "rdfs:Class" ? getClassMetadata(item["@id"]) : undefined;
  return {
    ...acc,
    ...(thisMeta ? { [item["@id"]]: thisMeta } : {}),
  };
});
