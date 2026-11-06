const { randomUUID } = require('node:crypto');

// A WebFrameMain may survive same-site document navigations. Reserve and watch
// the document lifetime before awaiting the Agent, not only after it is ready.
async function openWindowAgentChannel({ host, contents, frame, name, channels, isCurrent }) {
  if (!isCurrent() || channels.has(contents)) throw new Error('Agent channel unavailable');
  const endpoint = { channel: null, generation: randomUUID(), cleanup: null };
  const current = () =>
    channels.get(contents) === endpoint &&
    !contents.isDestroyed() &&
    contents.mainFrame === frame &&
    isCurrent();
  const cleanup = () => {
    if (channels.get(contents) === endpoint) channels.delete(contents);
    contents.off('did-start-navigation', navigate);
    contents.off('destroyed', cleanup);
    contents.off('render-process-gone', cleanup);
    const channel = endpoint.channel;
    endpoint.channel = null;
    channel?.close();
  };
  const navigate = (event, details, inPlace, main) => {
    // Current Electron carries the details on its first Event argument.
    // Keep the former object/positional forms for older shipped shells.
    const navigation = [event, details].find(
      (value) =>
        value &&
        typeof value === 'object' &&
        typeof value.isMainFrame === 'boolean' &&
        typeof value.isSameDocument === 'boolean',
    );
    if (navigation ? navigation.isMainFrame && !navigation.isSameDocument : main && !inPlace)
      cleanup();
  };
  endpoint.cleanup = cleanup;
  channels.set(contents, endpoint);
  contents.on('did-start-navigation', navigate);
  contents.once('destroyed', cleanup);
  contents.once('render-process-gone', cleanup);
  try {
    const channel = await host.open(name);
    if (!current()) {
      channel.close();
      throw new Error('Agent window changed');
    }
    endpoint.channel = channel;
    channel.onFrame((value) => {
      if (current()) frame.send('agent:frame', endpoint.generation, value);
    });
    channel.onEnd(() => {
      if (current()) frame.send('agent:end', endpoint.generation);
      cleanup();
    });
    return endpoint.generation;
  } catch (error) {
    cleanup();
    throw error;
  }
}
module.exports = { openWindowAgentChannel };
