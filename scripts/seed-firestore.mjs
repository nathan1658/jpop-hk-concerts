import { execFileSync } from "node:child_process";

import { seedConcerts } from "../src/data/concerts.ts";

const projectId = process.env.GCLOUD_PROJECT || "jpop-hk-concerts";
const token = execFileSync("gcloud", ["auth", "print-access-token"], {
  encoding: "utf8",
}).trim();

const toValue = (value) => {
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toValue),
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
        fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toValue(item)])),
      },
    };
  }

  return { stringValue: String(value ?? "") };
};

const toDocument = (event) => ({
  fields: Object.fromEntries(
    Object.entries(event)
      .filter(([key]) => key !== "id")
      .map(([key, value]) => [key, toValue(value)]),
  ),
});

const seedIds = new Set(seedConcerts.map((event) => event.id));

for (const event of seedConcerts) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/concerts/${event.id}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(toDocument(event)),
  });

  if (!response.ok) {
    throw new Error(`Failed to seed ${event.id}: ${response.status} ${await response.text()}`);
  }

  console.log(`Seeded ${event.id}`);
}

const listUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/concerts?pageSize=300`;
const listResponse = await fetch(listUrl, {
  headers: {
    authorization: `Bearer ${token}`,
  },
});

if (!listResponse.ok) {
  throw new Error(
    `Failed to list seeded collection: ${listResponse.status} ${await listResponse.text()}`,
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
        authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to delete stale event ${id}: ${response.status} ${await response.text()}`);
    }

    console.log(`Deleted stale ${id}`);
  }
}
