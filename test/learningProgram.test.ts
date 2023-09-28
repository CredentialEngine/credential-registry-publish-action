import * as dotenv from "dotenv";
import * as sinon from "sinon";
import * as core from "@actions/core";
import { describe, it } from "mocha";

import { run } from "../src/runner";

// Loads inputs as env vars from .env file, so that they're available to core.getInput() calls
dotenv.config();

describe("Learning Program", () => {
  it("should fail if registry_env is not defined", function () {
    // Arrange
    const cachedRegistryEnv = process.env.INPUT_REGISTRY_ENV;
    delete process.env.INPUT_REGISTRY_ENV;

    const errorSpy = sinon.spy(core, "error");

    // Act
    run();

    // Assert that registry env error is logged to the console.
    sinon.assert.calledWithMatch(errorSpy, /Invalid registry environment\./);

    // Clean up
    process.env.INPUT_REGISTRY_ENV = cachedRegistryEnv;
    errorSpy.restore();
  });
});
