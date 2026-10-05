import { describe, expect, it } from 'vitest';
import { EditorPanels } from './editor-panels';

function setup(options: { readOnly?: boolean; hasOtherLocales?: boolean } = {}) {
  const { readOnly = false, hasOtherLocales = true } = options;
  return new EditorPanels({
    canOpenFolderPopover: () => !readOnly,
    canOpenLocalesDrawer: () => hasOtherLocales,
  });
}

describe('EditorPanels', () => {
  describe('folder popover', () => {
    it('starts closed with nothing staged, filtered or requested', () => {
      const panels = setup();

      expect(panels.isFolderPopoverOpen()).toBe(false);
      expect(panels.stagedFolderPath()).toBeNull();
      expect(panels.folderFilter()).toBe('');
      expect(panels.focusRequest()).toBeNull();
    });

    it('opens, resets staging and filter, and asks for the filter input', () => {
      const panels = setup();
      panels.openFolderPopover();
      panels.stageFolder('a.b');
      panels.setFolderFilter('err');
      panels.closeFolderPopover();

      panels.openFolderPopover();

      expect(panels.isFolderPopoverOpen()).toBe(true);
      expect(panels.stagedFolderPath()).toBeNull();
      expect(panels.folderFilter()).toBe('');
      expect(panels.focusRequest()?.target).toBe('folder-filter');
    });

    it('keeps a restaged folder and filter until the popover is reopened', () => {
      const panels = setup();
      panels.openFolderPopover();
      panels.stageFolder('a');
      panels.stageFolder('a.b');
      panels.setFolderFilter('b');

      expect(panels.stagedFolderPath()).toBe('a.b');
      expect(panels.folderFilter()).toBe('b');
    });

    it('toggles shut on a second use', () => {
      const panels = setup();

      panels.toggleFolderPopover();
      expect(panels.isFolderPopoverOpen()).toBe(true);
      panels.toggleFolderPopover();
      expect(panels.isFolderPopoverOpen()).toBe(false);
    });

    it('does not open when the editor is view-only', () => {
      const panels = setup({ readOnly: true });

      panels.toggleFolderPopover();
      panels.openFolderPopover();

      expect(panels.isFolderPopoverOpen()).toBe(false);
      expect(panels.focusRequest()).toBeNull();
    });

    it('stages a folder and hands it back on confirm, closing and returning focus to the pill', () => {
      const panels = setup();
      panels.openFolderPopover();
      panels.stageFolder('common.errors');
      expect(panels.stagedFolderPath()).toBe('common.errors');

      expect(panels.confirmStagedFolder()).toBe('common.errors');

      expect(panels.isFolderPopoverOpen()).toBe(false);
      expect(panels.stagedFolderPath()).toBeNull();
      expect(panels.focusRequest()?.target).toBe('location-pill');
    });

    it('confirms nothing when no folder was staged', () => {
      const panels = setup();
      panels.openFolderPopover();

      expect(panels.confirmStagedFolder()).toBeNull();
      expect(panels.isFolderPopoverOpen()).toBe(false);
    });

    it('does not steal focus when a second close arrives after it is already closed', () => {
      const panels = setup();
      panels.openFolderPopover();
      panels.closeFolderPopover();
      const afterFirstClose = panels.focusRequest();
      panels.requestFocus('comment');
      const elsewhere = panels.focusRequest();

      panels.closeFolderPopover();

      expect(afterFirstClose?.target).toBe('location-pill');
      expect(panels.focusRequest()).toBe(elsewhere);
    });
  });

  describe('locales drawer', () => {
    it('opens and asks for its first control', () => {
      const panels = setup();

      panels.openLocalesDrawer();

      expect(panels.isLocalesDrawerOpen()).toBe(true);
      expect(panels.focusRequest()?.target).toBe('drawer-first-control');
    });

    it('does not open when there is no other locale', () => {
      const panels = setup({ hasOtherLocales: false });

      panels.openLocalesDrawer();

      expect(panels.isLocalesDrawerOpen()).toBe(false);
      expect(panels.focusRequest()).toBeNull();
    });

    it('hands focus back to the row on close, but only when it was open', () => {
      const panels = setup();
      panels.closeLocalesDrawer();
      expect(panels.focusRequest()).toBeNull();

      panels.openLocalesDrawer();
      panels.closeLocalesDrawer();

      expect(panels.isLocalesDrawerOpen()).toBe(false);
      expect(panels.focusRequest()?.target).toBe('locales-row');
    });
  });

  describe('context disclosure', () => {
    it('toggles without asking for focus', () => {
      const panels = setup();

      panels.toggleContext();
      expect(panels.isContextOpen()).toBe(true);
      panels.toggleContext();
      expect(panels.isContextOpen()).toBe(false);
      expect(panels.focusRequest()).toBeNull();
    });
  });

  describe('dismissal', () => {
    it('reports nothing consumed when no panel is open', () => {
      expect(setup().dismissNearest()).toBe(false);
    });

    it('closes the popover first, then the drawer, then lets the dialog go', () => {
      const panels = setup();
      panels.openLocalesDrawer();
      panels.openFolderPopover();

      expect(panels.dismissNearest()).toBe(true);
      expect(panels.isFolderPopoverOpen()).toBe(false);
      expect(panels.isLocalesDrawerOpen()).toBe(true);
      expect(panels.focusRequest()?.target).toBe('location-pill');

      expect(panels.dismissNearest()).toBe(true);
      expect(panels.isLocalesDrawerOpen()).toBe(false);
      expect(panels.focusRequest()?.target).toBe('locales-row');

      expect(panels.dismissNearest()).toBe(false);
    });

    it('does not treat the context disclosure as dismissible', () => {
      const panels = setup();
      panels.toggleContext();

      expect(panels.dismissNearest()).toBe(false);
      expect(panels.isContextOpen()).toBe(true);
    });
  });

  describe('closing for a validation failure', () => {
    it('closes both panels without restoring focus to either opener', () => {
      const panels = setup();
      panels.openLocalesDrawer();
      panels.openFolderPopover();
      panels.stageFolder('a');
      const lastIntent = panels.focusRequest();

      panels.closeAll();

      expect(panels.isFolderPopoverOpen()).toBe(false);
      expect(panels.isLocalesDrawerOpen()).toBe(false);
      expect(panels.stagedFolderPath()).toBeNull();
      expect(panels.focusRequest()).toBe(lastIntent);
    });
  });

  describe('focus requests', () => {
    it('issues a new request each time, even for the same target', () => {
      const panels = setup();

      panels.requestFocus('comment');
      const first = panels.focusRequest();
      panels.requestFocus('comment');

      expect(panels.focusRequest()).not.toBe(first);
      expect(panels.focusRequest()?.target).toBe('comment');
    });
  });
});
