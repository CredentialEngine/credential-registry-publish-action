import fs from "fs";
import fetch from "node-fetch-cache";
import path from "path";

// Define the schema URLs and output file names
const schemaUrls = [
  {
    url: "https://credreg.net/ctdl/schema/encoding/json",
    file: "ctdl-schema.ts",
  },
  {
    url: "https://credreg.net/ctdlasn/schema/encoding/json",
    file: "ctdlasn-schema.ts",
  },
  {
    url: "https://credreg.net/qdata/schema/encoding/json",
    file: "qdata-schema.ts",
  },
];

const process = async () => {
  // Download the schema files and save them to disk
  for (const { url, file } of schemaUrls) {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    const jsonData = await response.json();
    const jsonOutput = `${JSON.stringify(jsonData["@graph"], null, 2)};\n`;
    const output = `export const schema = ${jsonOutput}`;
    fs.writeFileSync(path.join("src", file), output, { flag: "w" });
    console.log(`Downloaded ${file}`);
  }
};

process().then(() => console.log("Done!"));
