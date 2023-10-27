#!/bin/bash

# Download the ctdl-schema.json file
curl -o ctdl-schema.json https://credreg.net/ctdl/schema/encoding/json

# Download the ctdlasn-schema.json file
curl -o ctdlasn-schema.json https://credreg.net/ctdlasn/schema/encoding/json

# Download the qdata-schema.json file
curl -o qdata-schema.json https://credreg.net/qdata/schema/encoding/json

# Function to create TypeScript file from JSON file
create_ts_file() {
  # Read the contents of the JSON file into a variable
  json=$(cat "$1")

  # Exit if json is empty
  if [ -z "$json" ]; then
    echo "Error: $1 doesn't exist or is empty."
    exit 1
  fi

  # Escape any double quotes in the JSON string
  json="${json//\"/\\\"}"

  # Write the TypeScript file
  truncate -s 0 src/"$2"
  echo "export default JSON.parse(\"$json\");" > "$2"
}

# Create TypeScript files for ctdl-schema.json, ctdlasn-schema.json, and qdata-schema.json
create_ts_file "ctdl-schema.json" "ctdl-schema.ts"
create_ts_file "ctdlasn-schema.json" "ctdlasn-schema.ts"
create_ts_file "qdata-schema.json" "qdata-schema.ts"

