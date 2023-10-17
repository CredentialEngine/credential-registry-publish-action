import * as dotenv from "dotenv";
import * as sinon from "sinon";
import * as core from "@actions/core";
import { describe, it } from "mocha";
import expect from "expect.js";

import { run } from "../src/runner";
import { RegistryConfig } from "../src/types";
import {
  processEntity,
  entityStore,
  extractGraphForEntity,
} from "../src/graphs";

// Loads inputs as env vars from .env file, so that they're available to core.getInput() calls
dotenv.config();

const defaultRegistryConfig: RegistryConfig = {
  registryBaseUrl: "https://credentialengineregistry.org",
  registryEnv: "sandbox",
  registryApiKey: "secret",
  registryOrgCtid: "ce-1234",
  dryRun: false,
};

describe("Learning Program", () => {
  it("should fail if registry_env is not defined", async function () {
    // Arrange
    const cachedRegistryEnv = process.env.INPUT_REGISTRY_ENV;
    delete process.env.INPUT_REGISTRY_ENV;

    const errorSpy = sinon.spy(core, "error");

    // Act
    run();

    // Assert that registry env error is logged to the console.
    sinon.assert.calledWithMatch(
      errorSpy,
      sinon.match(/Invalid registry environment\./)
    );

    // Clean up
    process.env.INPUT_REGISTRY_ENV = cachedRegistryEnv;
    errorSpy.restore();
  });
});

describe("Learning Program Graph Preparation", () => {
  beforeEach(() => {
    entityStore.reset();
  });

  afterEach(() => {
    entityStore.reset();
  });

  it("should replace the document ID and create a sameAs relationship", async function () {
    const testEntity = {
      "@id": "https://example.com/learningProgram/1",
      "@type": "ceterms:LearningProgram",
      "ceterms:ctid": "ce-1234",
    };

    const doc = await processEntity(testEntity, defaultRegistryConfig);

    expect(doc["@id"]).to.equal(
      `${defaultRegistryConfig.registryBaseUrl}/resources/ce-1234`
    );
    expect(doc["ceterms:sameAs"]).to.eql([
      "https://example.com/learningProgram/1",
    ]);
  });

  it("should properly situate an object referenced in a relationship property as a blank node in the graph", async function () {
    const testEntity = {
      "@id":
        "https://example.com/learningProgram/b304a9b7-61f0-465d-83cb-5a4411a5f75c",
      "@type": "ceterms:LearningProgram",
      "ceterms:ctid": "b304a9b7-61f0-465d-83cb-5a4411a5f75c",
      "ceterms:approvedBy": {
        "@type": "ceterms:QACredentialOrganization",
        "ceterms:name": {
          "en-US": "Example Town Cyber Security Jobs Center",
        },
        "ceterms:description": {
          "en-US":
            "The Example Town Cyber Security Jobs Center facilitates hiring of qualified cyber security professionals by local employers who need qualified cyber security professionals.",
        },
        "ceterms:subjectWebpage":
          "https://example.com/#cybersecurityjobscenter",
      },
    };

    const doc = await processEntity(testEntity, defaultRegistryConfig);

    expect(Object.keys(entityStore.entities).length).to.equal(2);
    expect(doc["ceterms:approvedBy"][0]).to.contain("_:");
    expect(entityStore.get(doc["ceterms:approvedBy"]).entity["@id"]).to.eql(
      doc["ceterms:approvedBy"][0]
    );
  });

  it("should treat a registry url-identified object as a non-blank node, but move it around", async function () {
    const testEntity = {
      "@id":
        "https://example.com/learningProgram/b304a9b7-61f0-465d-83cb-5a4411a5f75c",
      "@type": "ceterms:LearningProgram",
      "ceterms:ctid": "b304a9b7-61f0-465d-83cb-5a4411a5f75c",
      "ceterms:approvedBy": {
        "@id": `${defaultRegistryConfig.registryBaseUrl}/resources/ce-1234`,
        "@type": "ceterms:QACredentialOrganization",
        "ceterms:name": {
          "en-US": "Example Town Cyber Security Jobs Center",
        },
        "ceterms:description": {
          "en-US":
            "The Example Town Cyber Security Jobs Center facilitates hiring of qualified cyber security professionals by local employers who need qualified cyber security professionals.",
        },
        "ceterms:subjectWebpage":
          "https://example.com/#cybersecurityjobscenter",
      },
    };

    const doc = await processEntity(testEntity, defaultRegistryConfig);

    expect(Object.keys(entityStore.entities).length).to.equal(2);
    expect(doc["ceterms:approvedBy"][0]).to.contain("_:");
    expect(entityStore.get(doc["ceterms:approvedBy"][0]).entity["@id"]).to.eql(
      doc["ceterms:approvedBy"][0]
    );
  });

  it("should be ok with a node identified with a blank node identifier, no duplicates", async function () {
    const testEntity = {
      "@id":
        "https://example.com/learningProgram/b304a9b7-61f0-465d-83cb-5a4411a5f75c",
      "@type": "ceterms:LearningProgram",
      "ceterms:ctid": "b304a9b7-61f0-465d-83cb-5a4411a5f75c",
      "ceterms:approvedBy": [
        {
          "@id": `_:2751e0bb-dc56-4524-afe3-1e3d48841876`,
          "@type": "ceterms:QACredentialOrganization",
        },
      ],
      "ceterms:regulatedBy": [
        {
          "@id": `_:2751e0bb-dc56-4524-afe3-1e3d48841876`,
          "@type": "ceterms:QACredentialOrganization",
        },
      ],
    };

    const doc = await processEntity(testEntity, defaultRegistryConfig);

    expect(Object.keys(entityStore.entities).length).to.equal(2); // Not three, because the blank node is the same entity
    expect(doc["ceterms:approvedBy"][0]).to.contain("_:");
    expect(entityStore.get(doc["ceterms:regulatedBy"][0]).entity["@id"]).to.eql(
      doc["ceterms:regulatedBy"][0]
    );
    expect(entityStore.get(doc["ceterms:approvedBy"][0]).entity["@id"]).to.eql(
      doc["ceterms:approvedBy"][0]
    );
  });

  it("should process a ConditionProfile into the graph", async function () {
    const testEntity = {
      "@id":
        "https://example.com/learningProgram/b304a9b7-61f0-465d-83cb-5a4411a5f75c",
      "@type": "ceterms:LearningProgram",
      "ceterms:ctid": "b304a9b7-61f0-465d-83cb-5a4411a5f75c",
      "ceterms:requires": [
        {
          "@type": "ceterms:ConditionProfile",
          "ceterms:name": {
            "en-US": "Program Prerequisite Conditions",
          },
          "ceterms:assertedBy": [
            "https://credentialengine.github.io/credential-registry-ingest-examples/Organization/1/Organization-1.json",
          ],
          "ceterms:description": {
            "en-US":
              "Anyone who is a high school graduate or anyone age 18 or older can enroll.",
          },
        },
      ],
    };

    const doc = await processEntity(testEntity, defaultRegistryConfig);
    expect(Object.keys(entityStore.entities).length).to.equal(2);
    expect(doc["ceterms:requires"][0]).to.contain("_:");

    const graph = extractGraphForEntity(doc["@id"], defaultRegistryConfig);
    expect(graph["@graph"].length).to.equal(2);
    expect(graph["@graph"][1]["@type"]).to.equal("ceterms:ConditionProfile");
    expect(graph["@graph"][1]["@id"]).to.eql(doc["ceterms:requires"][0]);
  });
});
