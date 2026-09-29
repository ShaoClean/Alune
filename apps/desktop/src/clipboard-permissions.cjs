// Only the app's own renderer may write text; clipboard reads stay denied.
function canWriteClipboard(contents, permission, requestingUrl, trustedContents, origin) {
  if (
    !trustedContents ||
    contents !== trustedContents ||
    permission !== 'clipboard-sanitized-write'
  )
    return false;
  try {
    return new URL(requestingUrl).origin === origin;
  } catch {
    return false;
  }
}
module.exports = { canWriteClipboard };
