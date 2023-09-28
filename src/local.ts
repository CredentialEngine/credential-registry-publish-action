import * as dotenv from "dotenv";
import { run } from "./runner";

// Loads inputs as env vars from .env file, so that they're available to core.getInput() calls
dotenv.config();

run();
