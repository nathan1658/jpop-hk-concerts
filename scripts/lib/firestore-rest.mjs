import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";

const firestoreBaseUrl = (projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

const base64url = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const getServiceAccountToken = async (rawJson) => {
  const serviceAccount = JSON.parse(rawJson);
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: tokenUri,
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsignedJwt = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(unsignedJwt).sign(serviceAccount.private_key);
  const assertion = `${unsignedJwt}.${base64url(signature)}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange service account token: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return payload.access_token;
};

export const getAccessToken = async () => {
  if (process.env.FIRESTORE_ACCESS_TOKEN) {
    return process.env.FIRESTORE_ACCESS_TOKEN;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return getServiceAccountToken(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  return execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
  }).trim();
};

export const toFirestoreValue = (value) => {
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toFirestoreValue),
      },
    };
  }

  if (typeof value === "boolean") {
    return { booleanValue: value };
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: value } : { doubleValue: value };
  }

  if (value && typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== undefined && item !== null)
            .map(([key, item]) => [key, toFirestoreValue(item)]),
        ),
      },
    };
  }

  return { stringValue: String(value ?? "") };
};

export const toFirestoreDocument = (event) => ({
  fields: Object.fromEntries(
    Object.entries(event)
      .filter(([key, value]) => key !== "id" && value !== undefined && value !== null)
      .map(([key, value]) => [key, toFirestoreValue(value)]),
  ),
});

export const writeConcerts = async ({
  events,
  deleteStale = true,
  projectId = process.env.GCLOUD_PROJECT || "jpop-hk-concerts",
  token,
}) => {
  const accessToken = token ?? (await getAccessToken());
  const seedIds = new Set(events.map((event) => event.id));
  const baseUrl = firestoreBaseUrl(projectId);

  for (const event of events) {
    const response = await fetch(`${baseUrl}/concerts/${event.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(toFirestoreDocument(event)),
    });

    if (!response.ok) {
      throw new Error(`Failed to write ${event.id}: ${response.status} ${await response.text()}`);
    }

    console.log(`Synced ${event.id}`);
  }

  if (!deleteStale) {
    return;
  }

  const listResponse = await fetch(`${baseUrl}/concerts?pageSize=300`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!listResponse.ok) {
    throw new Error(
      `Failed to list concerts collection: ${listResponse.status} ${await listResponse.text()}`,
    );
  }

  const { documents = [] } = await listResponse.json();

  for (const document of documents) {
    const id = document.name.split("/").at(-1);

    if (!seedIds.has(id)) {
      const url = document.name.replace(/^projects\//, "https://firestore.googleapis.com/v1/projects/");
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to delete stale event ${id}: ${response.status} ${await response.text()}`);
      }

      console.log(`Deleted stale ${id}`);
    }
  }
};
