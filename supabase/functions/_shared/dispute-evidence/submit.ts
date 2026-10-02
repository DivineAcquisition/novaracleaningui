// Stage evidence without submitting. Submit exactly once.
// A second submit does not upload again.

export interface StripeDisputeClient {
  uploadFile(filename: string, bytes: Uint8Array): Promise<{ id: string }>;
  updateDispute(disputeId: string, body: Record<string, string>, submit: boolean): Promise<{ id: string; status?: string }>;
}

export interface SubmitState {
  status: string;
  fileIds: Record<string, string>;
}

export async function stageDisputeEvidence(
  client: StripeDisputeClient,
  disputeId: string,
  packets: Array<{ stripeField: string; filename: string; bytes: Uint8Array }>,
  textFields: Record<string, string>,
  state: SubmitState,
): Promise<SubmitState> {
  if (state.status === "submitted" || state.status === "accepted_without_evidence") {
    return state;
  }
  const fileIds = { ...state.fileIds };
  const body: Record<string, string> = {};
  for (const [key, value] of Object.entries(textFields)) {
    body[key.startsWith("evidence[") ? key : `evidence[${key}]`] = value;
  }
  for (const packet of packets) {
    if (!fileIds[packet.stripeField]) {
      const uploaded = await client.uploadFile(packet.filename, packet.bytes);
      fileIds[packet.stripeField] = uploaded.id;
    }
    body[`evidence[${packet.stripeField}]`] = fileIds[packet.stripeField];
  }
  await client.updateDispute(disputeId, body, false);
  return { status: "staged", fileIds };
}

export async function submitDisputeEvidence(
  client: StripeDisputeClient,
  disputeId: string,
  packets: Array<{ stripeField: string; filename: string; bytes: Uint8Array }>,
  textFields: Record<string, string>,
  state: SubmitState,
): Promise<{ state: SubmitState; alreadySubmitted: boolean }> {
  if (state.status === "submitted") {
    return { state, alreadySubmitted: true };
  }
  const staged = await stageDisputeEvidence(client, disputeId, packets, textFields, state);
  const body: Record<string, string> = {};
  for (const [field, id] of Object.entries(staged.fileIds)) body[`evidence[${field}]`] = id;
  for (const [k, v] of Object.entries(textFields)) {
    body[k.startsWith("evidence[") ? k : `evidence[${k}]`] = v;
  }
  await client.updateDispute(disputeId, body, true);
  return { state: { status: "submitted", fileIds: staged.fileIds }, alreadySubmitted: false };
}
