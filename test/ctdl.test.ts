// import * as sinon from "sinon";
import { describe, it } from "mocha";
import expect from "expect.js";

import {
  getClassMetadata,
  getTopLevelPointerPropertiesForClass,
} from "../src/ctdl";
import { entityStore, extractGraphForEntity } from "../src/graphs";
import { RegistryConfig } from "../src/types";
import { register } from "module";

const defaultRegistryConfigForTests: RegistryConfig = {
  registryBaseUrl: "https://sandbox.credentialengineregistry.org",
  registryEnv: "sandbox",
  registryApiKey: "secret",
  registryOrgCtid: "ce-1234",
  dryRun: false,
};

describe("Discovering information about CTDL Classes, Relationships, and API support", () => {
  it("should return the correct metadata for a primary class", function () {
    const metadata = getClassMetadata("ceterms:Credential");
    expect(metadata.isPrimary).to.be(true);
    expect(metadata.subClassOf).to.eql(undefined);
    expect(metadata.publishEndpoint).to.eql("/credential/publishGraph");

    const subMetadata = getClassMetadata("ceterms:Diploma");
    expect(subMetadata.isPrimary).to.be(true);
    expect(subMetadata.subClassOf).to.eql("ceterms:Credential");
    expect(subMetadata.publishEndpoint).to.eql("/credential/publishGraph");

    const metadata3 = getClassMetadata("ceterms:Organization");
    expect(metadata3.isPrimary).to.be(true);
    expect(metadata3.subClassOf).to.eql("ceterms:Agent");
    expect(metadata3.publishEndpoint).to.eql("/organization/publishGraph");
  });

  it("should return correct list of relationship props for LearningProgram", function () {
    const relationshipProps = getTopLevelPointerPropertiesForClass(
      "ceterms:LearningProgram"
    );
    expect(relationshipProps.includes("ceterms:hasPart")).to.be(true);
  });
});

describe("Entity store manipulation", () => {
  it("should register a new entity", function () {
    // Arrange
    const id = "http://example.com/credential/1";
    const entity = {
      "@id": id,
      "@type": "ceterms:Credential",
    };

    const entity2 = {
      "@id": "http://example.com/credential/2",
      "@type": "ceterms:Credential",
      "ceterms:hasPart": {
        "@id": id,
        "@type": "ceterms:Credential",
      },
    };

    // Act
    entityStore.registerEntity(entity, true, entity2["@id"]);

    // Assert
    expect(entityStore.get(id)).to.eql({
      fetched: true,
      entity,
      processed: false,
    });
    expect(entityStore.entitiesReferencedBy[entity2["@id"]]).to.eql([
      entity["@id"],
    ]);

    entityStore.reset();
  });
});

describe("Graph extraction", () => {
  it("should extract the right referenced nodes from a graph", function () {
    // Arrange
    const entities = [
      {
        "@id": "http://example.com/credential/1",
        "@type": "ceterms:Credential",
        "ceterms:hasPart": {
          "@id": "http://example.com/credential/2",
          "@type": "ceterms:Credential",
        },
      },
      {
        "@id": "http://example.com/credential/2",
        "@type": "ceterms:Credential",
      },
      {
        "@id": "http://example.com/credential/3",
        "@type": "ceterms:Credential",
      },
    ];

    entityStore.registerEntity(entities[0], true);
    entityStore.registerEntity(entities[1], false, entities[0]["@id"]);
    entityStore.registerEntity(entities[2], false);

    // Act
    const extracted = extractGraphForEntity(
      "http://example.com/credential/1",
      defaultRegistryConfigForTests
    );

    // Assert
    expect(extracted["@graph"].length).to.eql(2);
    expect(extracted["@graph"].map((e) => e["@id"])).to.eql([
      entities[0]["@id"],
      entities[1]["@id"],
    ]);
  });
});
