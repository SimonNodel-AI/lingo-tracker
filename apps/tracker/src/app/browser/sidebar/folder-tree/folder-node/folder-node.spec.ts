import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { FolderNode } from './folder-node';
import type { FolderNodeDto } from '@simoncodes-ca/data-transfer';
import { getTranslocoTestingModule } from '../../../../../testing/transloco-testing.module';

describe('FolderNode', () => {
  let component: FolderNode;
  let fixture: ComponentFixture<FolderNode>;

  const folderWithChildren: FolderNodeDto = {
    name: 'common',
    fullPath: 'common',
    loaded: true,
    tree: {
      path: 'common',
      resources: [],
      children: [{ name: 'buttons', fullPath: 'common.buttons', loaded: true }],
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FolderNode, getTranslocoTestingModule()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(FolderNode);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should accept folder input', () => {
    const folder: FolderNodeDto = {
      name: 'common',
      fullPath: 'common',
      loaded: false,
    };

    fixture.componentRef.setInput('folder', folder);
    expect(component.folder()).toEqual(folder);
  });

  it('should emit folderClick when folder is clicked', () => {
    const folder: FolderNodeDto = {
      name: 'common',
      fullPath: 'common',
      loaded: false,
    };

    fixture.componentRef.setInput('folder', folder);

    const emitSpy = vi.fn();
    component.folderClick.subscribe(emitSpy);

    component.onFolderClick();

    expect(emitSpy).toHaveBeenCalledWith(folder);
  });

  it('should request expansion when a collapsed folder with children is clicked', () => {
    fixture.componentRef.setInput('folder', folderWithChildren);

    const emitSpy = vi.fn();
    component.expandRequested.subscribe(emitSpy);

    component.onFolderClick();

    expect(emitSpy).toHaveBeenCalledWith('common');
  });

  it('should not request expansion when the folder is already expanded', () => {
    fixture.componentRef.setInput('folder', folderWithChildren);
    fixture.componentRef.setInput('expandedPaths', new Set(['common']));

    const emitSpy = vi.fn();
    component.expandRequested.subscribe(emitSpy);

    component.onFolderClick();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should not request expansion for a folder without children', () => {
    const folder: FolderNodeDto = {
      name: 'common',
      fullPath: 'common',
      loaded: true,
      tree: { path: 'common', resources: [], children: [] },
    };

    fixture.componentRef.setInput('folder', folder);

    const emitSpy = vi.fn();
    component.expandRequested.subscribe(emitSpy);

    component.onFolderClick();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should emit toggleExpanded from the chevron without selecting the folder', () => {
    fixture.componentRef.setInput('folder', folderWithChildren);

    const toggleSpy = vi.fn();
    const clickSpy = vi.fn();
    component.toggleExpanded.subscribe(toggleSpy);
    component.folderClick.subscribe(clickSpy);

    component.onToggleExpandedClick(new MouseEvent('click'));

    expect(toggleSpy).toHaveBeenCalledWith('common');
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('should render a chevron only for folders with children', () => {
    fixture.componentRef.setInput('folder', folderWithChildren);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.expand-toggle')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.expand-spacer')).toBeFalsy();

    fixture.componentRef.setInput('folder', {
      name: 'common',
      fullPath: 'common',
      loaded: true,
      tree: { path: 'common', resources: [], children: [] },
    } satisfies FolderNodeDto);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.expand-toggle')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('.expand-spacer')).toBeTruthy();
  });

  it('should render child folders only while expanded', () => {
    fixture.componentRef.setInput('folder', folderWithChildren);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.folder-children')).toBeFalsy();

    fixture.componentRef.setInput('expandedPaths', new Set(['common']));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.folder-children')).toBeTruthy();
  });

  it('should expand on ArrowRight and collapse on ArrowLeft', () => {
    fixture.componentRef.setInput('folder', folderWithChildren);

    const expandSpy = vi.fn();
    const toggleSpy = vi.fn();
    component.expandRequested.subscribe(expandSpy);
    component.toggleExpanded.subscribe(toggleSpy);

    // Collapsed: ArrowRight opens, ArrowLeft does nothing.
    component.onExpandKeydown(new KeyboardEvent('keydown'));
    component.onCollapseKeydown(new KeyboardEvent('keydown'));
    expect(expandSpy).toHaveBeenCalledWith('common');
    expect(toggleSpy).not.toHaveBeenCalled();

    // Expanded: ArrowLeft closes, ArrowRight does nothing more.
    expandSpy.mockClear();
    fixture.componentRef.setInput('expandedPaths', new Set(['common']));
    component.onExpandKeydown(new KeyboardEvent('keydown'));
    component.onCollapseKeydown(new KeyboardEvent('keydown'));
    expect(expandSpy).not.toHaveBeenCalled();
    expect(toggleSpy).toHaveBeenCalledWith('common');
  });

  it('should render folder name', () => {
    const folder: FolderNodeDto = {
      name: 'common',
      fullPath: 'common',
      loaded: false,
    };

    fixture.componentRef.setInput('folder', folder);
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    const folderNameElement = compiled.querySelector('.folder-name');
    expect(folderNameElement).toBeTruthy();
    expect(folderNameElement?.textContent?.trim()).toBe('common');
  });

  it('should show closed folder icon while collapsed', () => {
    fixture.componentRef.setInput('folder', folderWithChildren);
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    const folderIcon = compiled.querySelector('.folder-icon');
    expect(folderIcon).toBeTruthy();
    expect(folderIcon?.textContent?.trim()).toBe('folder');
  });

  it('should show open folder icon while expanded', () => {
    fixture.componentRef.setInput('folder', folderWithChildren);
    fixture.componentRef.setInput('expandedPaths', new Set(['common']));
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    const folderIcon = compiled.querySelector('.folder-icon');
    expect(folderIcon).toBeTruthy();
    expect(folderIcon?.textContent?.trim()).toBe('folder_open');
  });

  it('should apply selected class when folder is selected', () => {
    const folder: FolderNodeDto = {
      name: 'common',
      fullPath: 'common',
      loaded: false,
    };

    fixture.componentRef.setInput('folder', folder);
    fixture.componentRef.setInput('selectedPath', 'common');
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    expect(compiled.querySelector('.folder-header.selected')).toBeTruthy();
  });
});
