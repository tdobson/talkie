// Side-effect entry: importing this registers <talkie-player>. It does nothing on a server.
import { defineTalkiePlayer } from './element';

const tag = 'talkie-player';
if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
  defineTalkiePlayer(tag);
}

export { TalkiePlayerElement, defineTalkiePlayer } from './element';
