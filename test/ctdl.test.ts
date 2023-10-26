// import * as sinon from "sinon";
import { describe, it } from "mocha";
import expect from "expect.js";
import { v4 as uuidv4 } from "uuid";

import {
  classIsDescendantOf,
  getClassMetadata,
  getTopLevelPointerPropertiesForClass,
} from "../src/ctdl";
import {
  entityStore,
  extractGraphForEntity,
  getOrderedEntitiesToPublish,
} from "../src/graphs";
import { RegistryConfig } from "../src/types";
import { register } from "module";

const defaultRC: RegistryConfig = {
  registryBaseUrl: "https://sandbox.credentialengineregistry.org",
  registryEnv: "sandbox",
  registryApiKey: "secret",
  registryOrgCtid: "ce-1234",
  dryRun: false,
};

const basicEntity = (props: any, rc: RegistryConfig = defaultRC) => {
  const ctid = props["ceterms:ctid"] ?? `ce-${uuidv4()}`;
  return {
    "@id": `${rc.registryBaseUrl}/resources/${ctid}`,
    "@type": "ceterms:Credential",
    "ceterms:ctid": ctid,
    ...props,
  };
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

  it("should answer correctly about descendants", function () {
    expect(
      classIsDescendantOf("ceterms:Credential", "ceterms:Organization")
    ).to.be(false);
    expect(
      classIsDescendantOf("ceterms:Credential", "ceterms:Credential")
    ).to.be(true);
    expect(classIsDescendantOf("ceterms:Badge", "ceterms:Credential")).to.be(
      true
    );
    expect(classIsDescendantOf("ceterms:Credential", "ceterms:Badge")).to.be(
      false
    );

    // Non-existent classes
    expect(classIsDescendantOf("ceterms:Credential", "ceterms:Foo")).to.be(
      false
    );
    expect(classIsDescendantOf("ceterms:Foo", "ceterms:Credential")).to.be(
      false
    );
    expect(classIsDescendantOf("ceterms:Foo", "ceterms:Bar")).to.be(false);
  });
});

describe("Entity store manipulation", () => {
  beforeEach(() => {
    entityStore.reset();
  });

  afterEach(() => {
    entityStore.reset();
  });

  it("should register a new entity", function () {
    // Arrange
    const id = `${defaultRC.registryBaseUrl}/resources/ce-1234`;
    const entity = {
      "@id": id,
      "ceterms:ctid": "ce-1234",
      "@type": "ceterms:Credential",
    };

    const entity2 = {
      "@id": `${defaultRC.registryBaseUrl}/resources/ce-5678`,
      "@type": "ceterms:Credential",
      "ceterms:ctid": "ce-5678",
      "ceterms:hasPart": {
        "@id": id,
        "@type": "ceterms:Credential",
      },
    };

    // Act
    const stored1 = entityStore.registerEntity(
      entity,
      true,
      defaultRC,
      entity2["@id"]
    );

    // Assert
    expect(entityStore.get(id)).to.eql({
      fetched: true,
      entity,
      processed: false,
      sourceUrl: entity2["@id"],
    });
    expect(entityStore.entitiesReferencedBy[entity2["@id"]]).to.eql([
      entity["@id"],
    ]);

    entityStore.reset();
  });

  it("should fuzzy match an entity with sameAs", function () {
    const entity = {
      "@id": `${defaultRC.registryBaseUrl}/resources/ce-1234`,
      "@type": "ceterms:Credential",
      "ceterms:ctid": "ce-1234",
      "ceterms:sameAs": ["https://example.com/organization/1"],
    };
    entityStore.registerEntity(entity, true, defaultRC);
    expect(entityStore.get(entity["@id"])).to.not.be(undefined);
    expect(entityStore.get(entity["ceterms:sameAs"][0])).to.be(undefined);
    expect(entityStore.getFuzzy(entity["ceterms:sameAs"][0])).to.not.be(
      undefined
    );
  });
});

describe("Graph extraction", () => {
  beforeEach(() => {
    entityStore.reset();
  });

  afterEach(() => {
    entityStore.reset();
  });

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
        "ceterms:isPreparationFor": ["_:abc123"],
      },
      {
        "@id": "http://example.com/credential/2",
        "@type": "ceterms:Credential",
      },
      {
        "@id": "http://example.com/credential/3",
        "@type": "ceterms:Credential",
      },
      {
        "@id": "_:abc123",
        "@type": "ceterms:ConditionProfile",
      },
    ];

    entityStore.registerEntity(entities[0], true, defaultRC);
    entityStore.registerEntity(
      entities[1],
      false,
      defaultRC,
      entities[0]["@id"]
    );
    entityStore.registerEntity(entities[2], false, defaultRC);
    entityStore.registerEntity(
      entities[3],
      false,
      defaultRC,
      entities[0]["@id"]
    );

    // Act
    const extracted = extractGraphForEntity(
      "http://example.com/credential/1",
      defaultRC
    );

    // Assert
    expect(extracted["@graph"].length).to.eql(2);
    expect(extracted["@graph"].map((e) => e["@id"])).to.eql([
      entities[0]["@id"],
      entities[3]["@id"], // This entity is included because it's not a top-level class.
    ]);
  });
});

describe("Get ordered entities to publish", () => {
  beforeEach(() => {
    entityStore.reset();
  });

  afterEach(() => {
    entityStore.reset();
  });

  it("should not return an id not in the urls list", function () {
    const entities = {
      a: basicEntity({ "@type": "ceterms:Credential" }),
      b: basicEntity({ "@type": "ceterms:Organization" }),
    };
    entityStore.registerEntity(entities.a, false, defaultRC);
    entityStore.registerEntity(entities.b, false, defaultRC);

    const ordered = getOrderedEntitiesToPublish([entities.a["@id"]]);
    expect(ordered.length).to.eql(1);
    expect(ordered[0]).to.eql(entities.a["@id"]);
  });

  it("should not return an id unless it's a top-level class", function () {
    const entities = {
      a: basicEntity({ "@type": "ceterms:Credential" }),
      b: basicEntity({ "@type": "ceterms:ConditionProfile" }),
    };
    entityStore.registerEntity(entities.a, false, defaultRC);
    entityStore.registerEntity(entities.b, false, defaultRC);

    const ordered = getOrderedEntitiesToPublish([
      entities.a["@id"],
      entities.b["@id"],
    ]);
    expect(ordered.length).to.eql(1);
    expect(ordered[0]).to.eql(entities.a["@id"]);
  });

  it("should return entities in class order", function () {
    const entities = {
      a: basicEntity({ "@type": "ceterms:Credential" }),
      b: basicEntity({ "@type": "ceterms:BachelorDegree" }),
      c: basicEntity({ "@type": "ceterms:Organization" }),
      d: basicEntity({ "@type": "ceterms:LearningOpportunityProfile" }),
    };
    entityStore.registerEntity(entities.a, false, defaultRC);
    entityStore.registerEntity(entities.b, false, defaultRC);
    entityStore.registerEntity(entities.c, false, defaultRC);
    entityStore.registerEntity(entities.d, false, defaultRC);

    const ordered = getOrderedEntitiesToPublish(
      Object.values(entities).map((e) => e["@id"])
    );
    expect(ordered.length).to.eql(4);
    expect(ordered[0]).to.eql(entities.c["@id"]); // org first
    expect(ordered[3]).to.eql(entities.d["@id"]); // credentials in the middle, lopp last
  });

  it("should return entities sourced from a particular input graph", function () {
    const entities = {
      a: basicEntity({ "@type": "ceterms:Credential" }),
      b: basicEntity({ "@type": "ceterms:BachelorDegree" }),
      c: basicEntity({ "@type": "ceterms:Organization" }),
      d: basicEntity({ "@type": "ceterms:LearningOpportunityProfile" }),
    };
    entityStore.registerEntity(
      entities.a,
      false,
      defaultRC,
      "https://example.com/graph/1"
    );
    entityStore.registerEntity(entities.b, false, defaultRC);
    entityStore.registerEntity(
      entities.c,
      false,
      defaultRC,
      "https://example.com/graph/1"
    );
    entityStore.registerEntity(
      entities.d,
      false,
      defaultRC,
      "https://example.com/graph/1"
    );

    const ordered = getOrderedEntitiesToPublish([
      "https://example.com/graph/1",
    ]);
    expect(ordered.length).to.eql(3);
  });
});
