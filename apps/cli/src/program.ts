import { Command } from 'commander';
import { registerCommand } from './runner/register-command';
import { INIT_REGISTRATION } from './init/init-flags';
import { ADD_COLLECTION_REGISTRATION } from './add-collection/add-collection-flags';
import { DELETE_COLLECTION_REGISTRATION } from './delete-collection/delete-collection-flags';
import { ADD_LOCALE_REGISTRATION } from './commands/add-locale-flags';
import { REMOVE_LOCALE_REGISTRATION } from './commands/remove-locale-flags';
import { ADD_RESOURCE_REGISTRATION } from './add-resource/add-resource-flags';
import { EDIT_RESOURCE_REGISTRATION } from './commands/edit-resource-flags';
import { DELETE_RESOURCE_REGISTRATION } from './commands/delete-resource-flags';
import { MOVE_REGISTRATION } from './commands/move-flags';
import { NORMALIZE_REGISTRATION } from './commands/normalize-flags';
import { TRANSLATE_LOCALE_REGISTRATION } from './commands/translate-locale-flags';
import { BUNDLE_REGISTRATION } from './commands/bundle-flags';
import { EXPORT_REGISTRATION } from './commands/export-cmd-flags';
import { IMPORT_REGISTRATION } from './commands/import-cmd-flags';
import { VALIDATE_REGISTRATION } from './commands/validate-options';
import { FIND_SIMILAR_REGISTRATION } from './commands/find-similar-flags';
import { GLOSSARY_REGISTRATION } from './commands/glossary-flags';
import { EDIT_COLLECTION_REGISTRATION } from './commands/edit-collection-flags';
import { PROTECTED_TERMS_REGISTRATION } from './commands/protected-terms-flags';
import { PREFERRED_TERMINOLOGY_REGISTRATION } from './commands/preferred-terminology-flags';
import { INSTALL_SKILL_REGISTRATION } from './commands/install-skill-flags';

export function createCli(): Command {
  const program = new Command();

  program
    .name('lingo-tracker')
    .description('Effortlessly track, validate, and manage your translations')
    .version(__CLI_VERSION__);

  registerCommand(program, {
    ...INIT_REGISTRATION,
    load: () => import('./init/init').then((module) => module.initCommand),
  });

  registerCommand(program, {
    ...ADD_COLLECTION_REGISTRATION,
    load: () => import('./add-collection/add-collection').then((module) => module.addCollectionCommand),
  });

  registerCommand(program, {
    ...DELETE_COLLECTION_REGISTRATION,
    load: () => import('./delete-collection/delete-collection').then((module) => module.deleteCollectionCommand),
  });

  registerCommand(program, {
    ...ADD_LOCALE_REGISTRATION,
    load: () => import('./commands/add-locale').then((module) => module.addLocaleCommand),
  });

  registerCommand(program, {
    ...REMOVE_LOCALE_REGISTRATION,
    load: () => import('./commands/remove-locale').then((module) => module.removeLocaleCommand),
  });

  registerCommand(program, {
    ...ADD_RESOURCE_REGISTRATION,
    load: () => import('./add-resource/add-resource').then((module) => module.addResourceCommand),
  });

  registerCommand(program, {
    ...EDIT_RESOURCE_REGISTRATION,
    load: () => import('./commands/edit-resource').then((module) => module.editResourceCommand),
  });

  registerCommand(program, {
    ...DELETE_RESOURCE_REGISTRATION,
    load: () => import('./commands/delete-resource').then((module) => module.deleteResourceCommand),
  });

  registerCommand(program, {
    ...MOVE_REGISTRATION,
    load: () => import('./commands/move').then((module) => module.moveResourceCommand),
  });

  registerCommand(program, {
    ...NORMALIZE_REGISTRATION,
    load: () => import('./commands/normalize').then((module) => module.normalizeCommand),
  });

  registerCommand(program, {
    ...TRANSLATE_LOCALE_REGISTRATION,
    load: () => import('./commands/translate-locale').then((module) => module.translateLocaleCommand),
  });

  registerCommand(program, {
    ...BUNDLE_REGISTRATION,
    load: () => import('./commands/bundle').then((module) => module.bundleCommand),
  });

  registerCommand(program, {
    ...EXPORT_REGISTRATION,
    load: () => import('./commands/export-cmd').then((module) => module.exportCommand),
  });

  registerCommand(program, {
    ...IMPORT_REGISTRATION,
    load: () => import('./commands/import-cmd').then((module) => module.importCommand),
  });

  registerCommand(program, {
    ...VALIDATE_REGISTRATION,
    load: () => import('./commands/validate').then((module) => module.validateCommand),
  });

  registerCommand(program, {
    ...FIND_SIMILAR_REGISTRATION,
    load: () => import('./commands/find-similar').then((module) => module.findSimilarCommand),
  });

  registerCommand(program, {
    ...GLOSSARY_REGISTRATION,
    load: () => import('./commands/glossary').then((module) => module.glossaryCommand),
  });

  registerCommand(program, {
    ...EDIT_COLLECTION_REGISTRATION,
    load: () => import('./commands/edit-collection').then((module) => module.editCollectionCommand),
  });

  registerCommand(program, {
    ...PROTECTED_TERMS_REGISTRATION,
    load: () => import('./commands/protected-terms').then((module) => module.protectedTermsCommand),
  });

  registerCommand(program, {
    ...PREFERRED_TERMINOLOGY_REGISTRATION,
    load: () => import('./commands/preferred-terminology').then((module) => module.preferredTerminologyCommand),
  });

  registerCommand(program, {
    ...INSTALL_SKILL_REGISTRATION,
    load: () => import('./commands/install-skill').then((module) => module.installSkillCommand),
  });

  return program;
}
