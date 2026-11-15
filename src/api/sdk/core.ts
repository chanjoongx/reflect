// The client core of the Anthropic SDK: auth, retries, timeouts, errors.
// Loaded with import() from ../client.ts. A static re-export lets the bundler
// drop the parts of the SDK reflect never calls; importing the SDK's own
// module dynamically would keep all of it.
export { BaseAnthropic } from "@anthropic-ai/sdk/client";
