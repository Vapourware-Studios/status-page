// Random secrets for agents. Used for both durable agent tokens and the
// one-shot enrolment tokens minted in the admin panel.
export function generateAgentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
