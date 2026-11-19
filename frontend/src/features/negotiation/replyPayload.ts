export interface ReplyArguments {
  reply: string;
  sentText?: string;
}

export function replyArguments(
  _kind: "offer" | "question",
  reply: string,
  draft: string,
  editedDraft: string,
): ReplyArguments {
  return {
    reply,
    ...(editedDraft !== draft ? { sentText: editedDraft } : {}),
  };
}
