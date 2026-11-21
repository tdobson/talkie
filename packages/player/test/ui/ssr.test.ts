// The player project's jest setup needs a window, so this cannot run in the node environment.
// Instead the DOM globals a server lacks are taken away while the module is first evaluated.
describe('importing @talkie/player on a server', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { HTMLElement: g.HTMLElement, customElements: g.customElements };

  afterEach(() => {
    Object.assign(g, saved);
  });

  it('needs no HTMLElement and registers nothing', () => {
    delete g.HTMLElement;
    delete g.customElements;
    expect(typeof HTMLElement).toBe('undefined');
    jest.isolateModules(() => {
      const player = require('../../src/index');
      expect(typeof player.TalkiePlayerElement).toBe('function');
      expect(typeof player.TalkieEngine).toBe('function');
      expect(() => player.defineTalkiePlayer()).not.toThrow();
      expect(() => require('../../src/define')).not.toThrow();
    });
  });

  it('registers nothing in a browser until asked', () => {
    jest.isolateModules(() => {
      require('../../src/index');
      expect(customElements.get('talkie-player')).toBeUndefined();
      require('../../src/define');
      expect(customElements.get('talkie-player')).toBeDefined();
    });
  });
});
