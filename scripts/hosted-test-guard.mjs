// Separate approval gate for the hosted test roster.
// The local provision script still refuses every hosted project.

export const hostedTestProjectRef = "uyhithfdmphilleusiom";
export const hostedTestProjectHost = "uyhithfdmphilleusiom.supabase.co";

const provisionFlag = "--approve-hosted-test-accounts";
const cleanupFlag = "--approve-hosted-test-cleanup";

function flagValue(argv, name) {
  const match = argv.find((arg) => arg === name || arg.startsWith(`${name}=`));
  if (!match) return null;
  if (match === name) return "";
  return match.slice(name.length + 1);
}

export function assertHostedTestApproval(argv) {
  const provision = flagValue(argv, provisionFlag);
  const cleanup = flagValue(argv, cleanupFlag);
  if (provision !== null && cleanup !== null) {
    throw new Error("Refusing: choose provision or cleanup, not both.");
  }
  if (provision === null && cleanup === null) {
    throw new Error("Refusing: hosted test accounts stay off without an exact approval flag.");
  }
  const ref = provision ?? cleanup;
  if (ref !== hostedTestProjectRef) {
    throw new Error("Refusing: the approval flag does not match the hosted project.");
  }
  return { action: provision !== null ? "provision" : "cleanup", ref };
}

export function assertHostedTestTarget(url, ref) {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    throw new Error("Refusing: Supabase URL is missing or invalid.");
  }
  if (ref !== hostedTestProjectRef || host !== hostedTestProjectHost) {
    throw new Error("Refusing: hosted test accounts can target only the approved project.");
  }
  return host;
}
