/** Bump when an older client would discard newly persisted domain fields. */
export const CLIENT_DATA_VERSION=3;
export function requireReadableVersion(version:unknown){
  if(version!==undefined&&(!Number.isSafeInteger(version)||Number(version)>CLIENT_DATA_VERSION))throw new Error('This workspace was updated by a newer Rivet version. Update Rivet before editing; your saved work is retained.');
}
