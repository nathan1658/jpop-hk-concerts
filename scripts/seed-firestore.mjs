import { seedConcerts } from "../src/data/concerts.ts";
import { writeConcerts } from "./lib/firestore-rest.mjs";

await writeConcerts({ events: seedConcerts });
