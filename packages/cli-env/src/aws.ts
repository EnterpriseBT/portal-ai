/**
 * AWS secret / SSM-parameter resolution — the IAM authorization path (#194,
 * Decision 2).
 *
 * Credentials are AMBIENT (aws sso login / AWS_PROFILE / CI OIDC) — this
 * package never caches or manages AWS credentials itself. The operator's IAM
 * identity is the per-environment permission boundary: being able to read
 * `portalai/${envName}/*` IS the authorization to touch that environment.
 *
 * Failure taxonomy (the typed-error contract): credential/permission-shaped
 * failures → ENV_NOT_AUTHORIZED (fix: aws sso login / IAM grant); everything
 * else → ENV_INFRA_ERROR (cause preserved).
 */

import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";

import {
  EnvInfraError,
  EnvNotAuthorizedError,
  EnvNotConfiguredError,
} from "./errors.js";
import {
  secretsPrefix,
  ssmPrefix,
  type EnvironmentDefinition,
} from "./registry.js";

/** AWS error names that mean "your credentials/permissions", not "AWS is down". */
const CREDENTIAL_ERROR_NAMES = new Set([
  "CredentialsProviderError",
  "ExpiredTokenException",
  "ExpiredToken",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "AccessDeniedException",
  "AccessDenied",
  "UnauthorizedException",
]);

function classify(err: unknown, what: string): never {
  const name = (err as Error)?.name ?? "";
  if (CREDENTIAL_ERROR_NAMES.has(name)) {
    throw new EnvNotAuthorizedError(
      `Not authorized to read ${what} — check your AWS credentials (aws sso login) and IAM permissions`,
      { cause: err }
    );
  }
  throw new EnvInfraError(
    `Failed to read ${what}: ${(err as Error)?.message}`,
    {
      cause: err,
    }
  );
}

function requireAws(
  def: EnvironmentDefinition
): NonNullable<EnvironmentDefinition["aws"]> {
  if (!def.aws) {
    throw new EnvNotConfiguredError(
      `Environment "${def.name}" has no AWS configuration (local-only)`
    );
  }
  return def.aws;
}

/** Secrets Manager: `${secretsPrefix}/<name>`, e.g. portalai/dev/database-url. */
export async function getSecret(
  def: EnvironmentDefinition,
  name: string
): Promise<string> {
  const aws = requireAws(def);
  const secretId = `${secretsPrefix(def)}/${name}`;
  const client = new SecretsManagerClient({ region: aws.region });
  try {
    const out = await client.send(
      new GetSecretValueCommand({ SecretId: secretId })
    );
    if (out.SecretString == null) {
      throw new EnvInfraError(`Secret ${secretId} has no string value`);
    }
    return out.SecretString;
  } catch (err) {
    if (err instanceof EnvInfraError) throw err;
    classify(err, `secret ${secretId}`);
  }
}

/** SSM Parameter Store: `${ssmPrefix}/<name>`, e.g. /portalai/dev/auth0-domain. */
export async function getParam(
  def: EnvironmentDefinition,
  name: string
): Promise<string> {
  const aws = requireAws(def);
  const paramName = `${ssmPrefix(def)}/${name}`;
  const client = new SSMClient({ region: aws.region });
  try {
    // WithDecryption is a no-op for String params and required for
    // SecureString — parity with the bash's `--with-decryption`.
    const out = await client.send(
      new GetParameterCommand({ Name: paramName, WithDecryption: true })
    );
    const value = out.Parameter?.Value;
    if (value == null) {
      throw new EnvInfraError(`SSM parameter ${paramName} has no value`);
    }
    return value;
  } catch (err) {
    if (err instanceof EnvInfraError) throw err;
    classify(err, `SSM parameter ${paramName}`);
  }
}

/** The env's DATABASE_URL secret (the DB path's connection source). */
export function getDatabaseUrl(def: EnvironmentDefinition): Promise<string> {
  return getSecret(def, "database-url");
}

/**
 * Update-or-create a secret (#192 — the write half of the vars catalog).
 * Returns `{ created: true }` when the secret didn't exist and was created —
 * the CALLER must warn: a brand-new secret's ARN has to be added to the
 * deploy workflow / CloudFormation parameters before the next deploy.
 */
export async function putSecret(
  def: EnvironmentDefinition,
  name: string,
  value: string
): Promise<{ created: boolean }> {
  const aws = requireAws(def);
  const secretId = `${secretsPrefix(def)}/${name}`;
  const client = new SecretsManagerClient({ region: aws.region });
  try {
    await client.send(
      new PutSecretValueCommand({ SecretId: secretId, SecretString: value })
    );
    return { created: false };
  } catch (err) {
    if ((err as Error)?.name !== "ResourceNotFoundException") {
      classify(err, `secret ${secretId}`);
    }
  }
  try {
    await client.send(
      new CreateSecretCommand({ Name: secretId, SecretString: value })
    );
    return { created: true };
  } catch (err) {
    classify(err, `secret ${secretId}`);
  }
}

/** Upsert an SSM parameter (Overwrite: true). Type defaults to String. */
export async function putParam(
  def: EnvironmentDefinition,
  name: string,
  value: string,
  type: "String" | "SecureString" = "String"
): Promise<void> {
  const aws = requireAws(def);
  const paramName = `${ssmPrefix(def)}/${name}`;
  const client = new SSMClient({ region: aws.region });
  try {
    await client.send(
      new PutParameterCommand({
        Name: paramName,
        Value: value,
        Type: type,
        Overwrite: true,
      })
    );
  } catch (err) {
    classify(err, `SSM parameter ${paramName}`);
  }
}
