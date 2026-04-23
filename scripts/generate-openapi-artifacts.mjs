import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const specPath = path.join(root, "openapi.yaml");
const generatedValidationPath = path.join(root, "apps", "api", "lib", "generated-openapi.mjs");
const generatedTypesPath = path.join(root, "packages", "trust-sdk", "generated-contracts.d.ts");
const checkMode = process.argv.includes("--check");

const spec = YAML.parse(readFileSync(specPath, "utf8"));
const schemas = spec.components?.schemas ?? {};
const paths = spec.paths ?? {};

function schemaRefName(ref) {
  return ref.split("/").at(-1);
}

function resolveSchema(node) {
  if (!node) {
    return null;
  }
  if (node.$ref) {
    return resolveSchema(schemas[schemaRefName(node.$ref)]);
  }
  if (node.allOf) {
    return node.allOf.map(resolveSchema).reduce((acc, part) => mergeSchemas(acc, part), {});
  }
  return node;
}

function mergeSchemas(left, right) {
  if (!left || Object.keys(left).length === 0) {
    return structuredClone(right);
  }
  if (!right) {
    return structuredClone(left);
  }
  if ((left.type === "object" || left.properties || left.additionalProperties) && (right.type === "object" || right.properties || right.additionalProperties)) {
    return {
      type: "object",
      properties: {
        ...(left.properties ?? {}),
        ...(right.properties ?? {})
      },
      required: [...new Set([...(left.required ?? []), ...(right.required ?? [])])],
      additionalProperties:
        right.additionalProperties ?? left.additionalProperties ?? false
    };
  }
  return structuredClone(right);
}

function toValidationSchema(node, required = true) {
  const resolved = resolveSchema(node);
  const nullableFromType = Array.isArray(resolved?.type) && resolved.type.includes("null");
  const nullableFromOneOf = Boolean(resolved?.oneOf?.some((entry) => entry.type === "null"));
  const nullable = nullableFromType || nullableFromOneOf;
  let schema;

  if (!resolved) {
    schema = { kind: "object", shape: {}, allowUnknown: true };
  } else if (resolved.enum) {
    schema = { kind: "enum", values: resolved.enum };
  } else if (resolved.oneOf) {
    const firstReal = resolved.oneOf.find((entry) => entry.type !== "null");
    schema = toValidationSchema(firstReal, true);
  } else if (Array.isArray(resolved.type)) {
    const nonNull = resolved.type.find((entry) => entry !== "null");
    schema = toValidationSchema({ ...resolved, type: nonNull }, true);
  } else if (resolved.type === "string") {
    schema = {
      kind: "string",
      ...(resolved.minLength !== undefined ? { minLength: resolved.minLength } : {}),
      ...(resolved.maxLength !== undefined ? { maxLength: resolved.maxLength } : {})
    };
  } else if (resolved.type === "integer") {
    schema = {
      kind: "integer",
      ...(resolved.minimum !== undefined ? { min: resolved.minimum } : {}),
      ...(resolved.maximum !== undefined ? { max: resolved.maximum } : {})
    };
  } else if (resolved.type === "number") {
    schema = {
      kind: "number",
      ...(resolved.minimum !== undefined ? { min: resolved.minimum } : {}),
      ...(resolved.maximum !== undefined ? { max: resolved.maximum } : {})
    };
  } else if (resolved.type === "boolean") {
    schema = { kind: "boolean" };
  } else if (resolved.type === "array") {
    schema = {
      kind: "array",
      item: toValidationSchema(resolved.items ?? {}, true),
      ...(resolved.minItems !== undefined ? { minLength: resolved.minItems } : {}),
      ...(resolved.maxItems !== undefined ? { maxLength: resolved.maxItems } : {})
    };
  } else {
    const requiredKeys = new Set(resolved.required ?? []);
    const shape = {};
    for (const [key, child] of Object.entries(resolved.properties ?? {})) {
      shape[key] = toValidationSchema(child, requiredKeys.has(key));
    }
    schema = {
      kind: "object",
      shape,
      allowUnknown: Boolean(resolved.additionalProperties)
    };
  }

  if (nullable) {
    schema = { ...schema, nullable: true };
  }

  return required ? schema : { kind: "optional", schema };
}

function collectOperationScopes() {
  const operationScopes = {};
  for (const [routePath, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      operationScopes[`${method.toUpperCase()} ${routePath}`] = operation["x-infopunks-required-scope"] ?? null;
    }
  }
  return operationScopes;
}

function collectRequestSchemas() {
  const requestSchemas = {};
  for (const methods of Object.values(paths)) {
    for (const operation of Object.values(methods ?? {})) {
      const requestRef = operation.requestBody?.content?.["application/json"]?.schema?.$ref;
      if (!requestRef) {
        continue;
      }
      const name = schemaRefName(requestRef);
      requestSchemas[name] = toValidationSchema(schemas[name], true);
    }
  }
  return requestSchemas;
}

function toTs(node) {
  const resolved = resolveSchema(node);
  if (!resolved) {
    return "unknown";
  }
  if (resolved.$ref) {
    return schemaRefName(resolved.$ref);
  }
  if (resolved.allOf) {
    return resolved.allOf.map((entry) => toTs(entry)).join(" & ");
  }
  if (resolved.oneOf) {
    return resolved.oneOf.map((entry) => toTs(entry)).join(" | ");
  }
  if (resolved.enum) {
    return resolved.enum.map((entry) => JSON.stringify(entry)).join(" | ");
  }
  if (Array.isArray(resolved.type)) {
    return resolved.type.map((entry) => (entry === "null" ? "null" : toTs({ ...resolved, type: entry }))).join(" | ");
  }
  if (resolved.type === "string") {
    return "string";
  }
  if (resolved.type === "integer" || resolved.type === "number") {
    return "number";
  }
  if (resolved.type === "boolean") {
    return "boolean";
  }
  if (resolved.type === "array") {
    return `Array<${toTs(resolved.items ?? {})}>`;
  }

  const props = Object.entries(resolved.properties ?? {});
  const required = new Set(resolved.required ?? []);
  const members = props.map(([key, value]) => `  ${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${toTs(value)};`);
  if (resolved.additionalProperties === true) {
    members.push("  [key: string]: unknown;");
  } else if (resolved.additionalProperties && typeof resolved.additionalProperties === "object") {
    members.push(`  [key: string]: ${toTs(resolved.additionalProperties)};`);
  }
  return props.length === 0 && members.length === 0 ? "Record<string, unknown>" : `{\n${members.join("\n")}\n}`;
}

function generateTypesBody() {
  const lines = [
    "// AUTO-GENERATED FROM openapi.yaml. DO NOT EDIT BY HAND.",
    ""
  ];
  for (const schemaName of Object.keys(schemas)) {
    lines.push(`export type ${schemaName} = ${toTs(schemas[schemaName])};`, "");
  }
  return `${lines.join("\n").trim()}\n`;
}

function generateValidationBody() {
  const operationScopes = collectOperationScopes();
  const requestSchemas = collectRequestSchemas();
  return `// AUTO-GENERATED FROM openapi.yaml. DO NOT EDIT BY HAND.\nexport const generatedOperationScopes = ${JSON.stringify(operationScopes, null, 2)};\n\nexport const generatedRequestSchemas = ${JSON.stringify(requestSchemas, null, 2)};\n`;
}

function writeOrCheck(filePath, body) {
  const normalized = body.replace(/\r\n/g, "\n");
  const existing = readFileSync(filePath, "utf8");
  if (checkMode) {
    if (existing !== normalized) {
      console.error(`generate-openapi-artifacts failed: ${filePath} is out of date. Run npm run contract:generate.`);
      process.exit(1);
    }
    return;
  }
  writeFileSync(filePath, normalized);
}

mkdirSync(path.dirname(generatedValidationPath), { recursive: true });
mkdirSync(path.dirname(generatedTypesPath), { recursive: true });

const validationBody = generateValidationBody();
const typesBody = generateTypesBody();

for (const target of [generatedValidationPath, generatedTypesPath]) {
  try {
    readFileSync(target, "utf8");
  } catch {
    writeFileSync(target, "");
  }
}

writeOrCheck(generatedValidationPath, validationBody);
writeOrCheck(generatedTypesPath, typesBody);

console.log(`openapi artifacts ${checkMode ? "verified" : "generated"}: ${path.relative(root, generatedValidationPath)}, ${path.relative(root, generatedTypesPath)}`);
