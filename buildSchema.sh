#!/bin/bash

"echo"

# Download the ctdl-schema.json file
curl -o src/ctdl-schema.json https://credreg.net/ctdl/schema/encoding/json

# Download the ctdlasn-schema.json file
curl -o src/ctdlasn-schema.json https://credreg.net/ctdlasn/schema/encoding/json

# Download the qdata-schema.json file
curl -o src/qdata-schema.json https://credreg.net/qdata/schema/encoding/json

# Create a TypeScript file from JSON file
process_json_file() {
    input_file=$1
    output_file="${input_file%.json}.ts"

    if [ -f "$input_file" ]; then
        json_content=$(cat "$input_file" | jq -c .)
        echo "export default JSON.parse('$json_content');" > "$output_file"
        echo "Processed $input_file. Output saved to $output_file"
    else
        echo "Skipping $input_file as it doesn't exist."
    fi
}

# Process each JSON file
process_json_file "src/ctdl-schema.json"
process_json_file "src/ctdlasn-schema.json"
process_json_file "src/qdata-schema.json"