/** Turn a wallet/RPC error message into something a user can act on. */
export function friendlyError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw);
  if (/User rejected|rejected the request/i.test(msg)) return "Cancelled in wallet.";
  if (/insufficient (lamports|funds)|Attempt to debit an account but found no record/i.test(msg)) {
    return "Not enough SOL for this transaction plus fees.";
  }
  if (/block height exceeded|blockhash not found/i.test(msg)) return "The transaction expired before it landed. Try again.";
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}
