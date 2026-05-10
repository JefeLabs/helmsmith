import {
  configExists,
  configPath,
  readConfig,
  writeConfig,
  type SkillzkitConfig,
} from "../init/config.js";

export interface ConfigCliOptions {
  showSecrets?: boolean;
}

/**
 * View or update one config field. `skillzkit config` shows all;
 * `skillzkit config email new@x.com` updates that field.
 */
export function runConfigCommand(
  field: string | undefined,
  value: string | undefined,
  options: ConfigCliOptions = {},
): void {
  try {
    if (!configExists()) {
      console.error(`No config found. Run \`skillzkit init\` to create one.`);
      process.exit(1);
    }
    const config = readConfig();

    if (!field) {
      printConfig(config, !!options.showSecrets);
      return;
    }
    if (!value) {
      const single = readField(config, field);
      if (single === undefined) {
        console.error(
          `Field "${field}" is not set on this config (mode=${config.mode})`,
        );
        process.exit(1);
      }
      console.log(single);
      return;
    }
    const updated = setField(config, field, value);
    writeConfig(updated);
    console.log(`✓ Updated ${field} → ${value}`);
    console.log(`  ${configPath()}`);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * Render the current config to stdout. Plaintext API key is NEVER
 * shown (it isn't stored). The masked version is always shown. The
 * encrypted-blob fields are hidden by default; --show-secrets reveals
 * them so a user can verify what's on disk without grep-and-jq.
 */
function printConfig(config: SkillzkitConfig, showSecrets: boolean): void {
  console.log(`# skillzkit config`);
  console.log(`# ${configPath()}`);
  console.log("");
  console.log(`mode       = ${config.mode}`);
  console.log(`email      = ${config.email}`);
  console.log(`createdAt  = ${config.createdAt}`);
  console.log(`updatedAt  = ${config.updatedAt}`);
  if (config.mode === "team") {
    console.log("");
    console.log(`team.apiUrl    = ${config.team.apiUrl}`);
    console.log(`team.keyMasked = ${config.team.keyMasked}`);
    if (showSecrets) {
      const blob = config.team.keyEncrypted;
      console.log(`team.keyEncrypted.kdf       = ${blob.kdf}`);
      console.log(
        `team.keyEncrypted.kdfParams = N=${blob.kdfParams.N}, r=${blob.kdfParams.r}, p=${blob.kdfParams.p}`,
      );
      console.log(`team.keyEncrypted.salt      = ${blob.salt}`);
      console.log(`team.keyEncrypted.iv        = ${blob.iv}`);
      console.log(`team.keyEncrypted.authTag   = ${blob.authTag}`);
      console.log(
        `team.keyEncrypted.ciphertext = <${blob.ciphertext.length} chars base64>`,
      );
    }
  }
}

function readField(config: SkillzkitConfig, field: string): string | undefined {
  switch (field) {
    case "mode":
      return config.mode;
    case "email":
      return config.email;
    case "createdAt":
      return config.createdAt;
    case "updatedAt":
      return config.updatedAt;
    case "team.apiUrl":
    case "apiUrl":
      return config.mode === "team" ? config.team.apiUrl : undefined;
    case "team.keyMasked":
    case "keyMasked":
      return config.mode === "team" ? config.team.keyMasked : undefined;
    default:
      throw new Error(
        `Unknown field "${field}". Try one of: mode, email, apiUrl, keyMasked`,
      );
  }
}

function setField(
  config: SkillzkitConfig,
  field: string,
  value: string,
): SkillzkitConfig {
  switch (field) {
    case "email": {
      if (config.mode === "team") {
        throw new Error(
          `Changing email on a team-mode config would invalidate your encrypted API key (the email is part of the encryption passphrase). Use \`skillzkit init --force\` to change email and re-enter your API key + PIN.`,
        );
      }
      return { ...config, email: value };
    }
    case "team.apiUrl":
    case "apiUrl": {
      if (config.mode !== "team") {
        throw new Error(
          `apiUrl is only valid on team-mode configs. Run \`skillzkit init --force\` to switch modes.`,
        );
      }
      try {
        new URL(value);
      } catch {
        throw new Error(`Invalid URL "${value}"`);
      }
      return {
        ...config,
        team: { ...config.team, apiUrl: value },
      };
    }
    case "mode":
      throw new Error(
        `Mode change requires a full re-init (encryption + key collection). Run \`skillzkit init --force --mode ${value}\`.`,
      );
    default:
      throw new Error(
        `Field "${field}" is not settable. Settable fields: email, apiUrl. Use \`skillzkit init --force\` for anything else.`,
      );
  }
}
