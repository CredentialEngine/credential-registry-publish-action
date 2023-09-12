import * as core from "@actions/core";
import fetch from "node-fetch-cache";

type RegistryEnvironment = "sandbox" | "staging" | "production";

const run = async () => {
  const urls = core.getInput("urls");
  const registryEnv = core.getInput(
    "registry-environment"
  ) as RegistryEnvironment;
  const registryApiKey = core.getInput("registry-api-key");
  const registryOrgCtid = core.getInput("registry-org-ctid");

  core.info("Launching Credential Registry Publish Action");
  core.info(`Starting with URLs: ${urls}`);
  core.info(
    `Selected ${registryEnv} environment. Publishing for org ${registryOrgCtid}.`
  );

  core.info("Exiting... actual fetching and publishing not yet implemented.");
};

run();
