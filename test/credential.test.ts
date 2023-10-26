import * as dotenv from "dotenv";
import * as sinon from "sinon";
import * as errors from "../src/error";
import { httpClient } from "../src/http";
import { describe, it } from "mocha";
import expect from "expect.js";

import { RegistryConfig } from "../src/types";
import { processEntity, entityStore } from "../src/graphs";

// Loads inputs as env vars from .env file, so that they're available to core.getInput() calls
dotenv.config();

const defaultRegistryConfig: RegistryConfig = {
  registryBaseUrl: "https://sandbox.credentialengineregistry.org",
  registryEnv: "sandbox",
  registryApiKey: "secret",
  registryOrgCtid: "ce-1234",
  dryRun: false,
};

describe("Credential", () => {
  beforeEach(() => {
    entityStore.reset();
  });

  afterEach(() => {
    entityStore.reset();
  });

  it("should identify the correct CTID and ID", async function () {
    const entity = {
      "@context": "https://credreg.net/ctdl/schema/context/json",
      "@id": "http://example.com/credential/1",
      "@type": "ceterms:Badge",
      "ceterms:ctid": "ce-9999",
    };
    const processed = await processEntity(entity, defaultRegistryConfig);
    expect(processed["ceterms:ctid"]).to.eql("ce-9999");
    expect(processed["@id"]).to.eql(
      `${defaultRegistryConfig.registryBaseUrl}/resources/ce-9999`
    );
  });

  it("should produce an error on missing CTID", async function () {
    const entity = {
      "@context": "https://credreg.net/ctdl/schema/context/json",
      "@id": "http://example.com/credential/1",
      "@type": "ceterms:Badge",
    };
    let errorThrown = false;
    try {
      await processEntity(entity, defaultRegistryConfig);
    } catch (e) {
      expect(e).to.be.a(errors.ActionError);
      expect(e.message.includes("CTID")).to.be(true);
      errorThrown = true;
    } finally {
      expect(errorThrown).to.be(true);
    }
  });

  it("should process a blank node identifier for a QACredentialOrganization", async function () {
    const entity = {
      "@context": "https://credreg.net/ctdl/schema/context/json",
      "@id": "https://example.com/credential/1",
      "@type": "ceterms:Certificate",
      "ceterms:ctid": "ce-9999",
      "ceterms:recognizedBy": [
        {
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
      ],
    };
    const processed = await processEntity(entity, defaultRegistryConfig);
    expect(processed["ceterms:recognizedBy"][0].startsWith("_:")).to.be(true);

    const recognizedByNode = entityStore.get(
      processed["ceterms:recognizedBy"][0]
    );

    expect(recognizedByNode).to.not.be(undefined);
    expect(recognizedByNode.entity["@id"].startsWith("_:")).to.be(true);
    expect(recognizedByNode.entity["ceterms:sameAs"]).to.be(undefined);
  });

  it("should update relationships even in ConditionProfiles", async function () {
    // mock the fetch call to get the Organization
    const fetchStub = sinon.stub(httpClient, "fetch");
    fetchStub.resolves({
      json: async () => {
        return {
          "@context": "https://credreg.net/ctdl/schema/context/json",
          "@id": "https://example.com/theOrganization",
          "@type": "ceterms:Organization",
          "ceterms:ctid": "ce-1111",
        };
      },
      ok: true,
      status: 200,
      headers: {
        "Content-type": "application/json",
      },
    });

    const entity = {
      "@context": "https://credreg.net/ctdl/schema/context/json",
      "@id": "https://example.com/credential/1",
      "@type": "ceterms:DigitalBadge",
      "ceterms:ctid": "ce-9999",
      "ceterms:ownedBy": ["https://example.com/theOrganization"],
      "ceterms:requires": [
        {
          "@type": "ceterms:ConditionProfile",
          "ceterms:name": {
            "en-US": "Curriculum",
          },
          "ceterms:assertedBy": ["https://example.com/theOrganization"],
          "ceterms:description": {
            "en-US":
              "The online Cyber Security program places a strong emphasis on the identification, analysis, mitigation, and effective communication of risks associated with cyber systems, employing a range of tools, techniques, and technologies.",
          },
        },
      ],
    };

    const processed = await processEntity(entity, defaultRegistryConfig);

    expect(
      processed["ceterms:ownedBy"][0].startsWith(
        defaultRegistryConfig.registryBaseUrl
      )
    ).to.eql(true);
    expect(
      processed["ceterms:requires"][0]["ceterms:assertedBy"][0].startsWith(
        defaultRegistryConfig.registryBaseUrl
      )
    ).to.eql(true);

    fetchStub.restore();
  });
});
